# 投递服务

状态：Current。运行在 Electron `utilityProcess`，入口 `desktop/src/service/worker.mjs`。

## 职责与边界

服务进程是**唯一**拥有以下状态的地方：

- 当前账号、Bot 名单、运行时状态（主 Bot、置顶、分组、运行中）。
- SQLite 收件库（receipts / recipients / preferences）。
- 上传与发送队列。
- 分享收件箱的 drain 循环。

主进程通过 JSON RPC 调用它，渲染层永远不直接接触它。

## 源码入口

| 文件 | 作用 |
| --- | --- |
| `service/worker.mjs` | 进程入口、RPC 方法分发、分享 drain 定时器 |
| `service/session.mjs` | 账号会话、登录、名单刷新、watcher、发送队列、状态快照 |
| `service/store.mjs` | SQLite schema、receipts/recipients/preferences 读写 |
| `service/delivery.mjs` | 一条 receipt 的完整投递状态机 |
| `service/upload.mjs` | 文件上传（单 PUT / 分片边界） |
| `service/share-inbox.mjs` | 扫描 `ShareInbox/Ready`、校验 manifest、导入、移动目录 |
| `service/whatsapp-export.mjs` | 识别并解析 WhatsApp 导出（`_chat.txt` 或含它的 zip） |
| `service/source-defaults.mjs` | 每个来源的默认 Bot 和前缀 |
| `main/rpc.mjs` | 主进程侧 RPC 客户端 |

## RPC 方法

`initialize` 之后可用：

| 方法 | 作用 |
| --- | --- |
| `snapshot` | 全量状态：账号、Bot、recipients、inbox、theme、shortcuts、runtime、watchErrors、sourceDefaults |
| `login` / `desktopLogin` / `connect` / `logout` | 浏览器 PKCE、本机登录、连接、退出 |
| `refresh` | 刷新名单/运行时 |
| `duplicateBot` | 把同一 Bot 加为另一个接收单位（同名分组场景） |
| `configure` | 改 recipient（enabled/mode/prefix/sources/order） |
| `setSourceDefaults` | 改某个来源的默认 Bot 和前缀；指定 Bot 时打开该来源 |
| `disableAllReceive` | 单事务关闭该账号所有 enabled recipient |
| `receive` | 新建 receipt（入口统一走这里） |
| `submit` / `submitAsync` / `retry` / `resolve` / `composer` / `dismissComposer` | 补字发送、后台发送并立即返回 receipt id、重试失败项、核对解锁、取草稿、关闭草稿并清理附件 |
| `resume` | 启动时恢复未完成状态 |
| `theme` / `setShortcut` | 偏好 |
| `watch` | 订阅某 Bot/session 回复 |
| `shutdown` | 停 drain、关 watcher、关库 |

错误码是稳定的 `UPPER_SNAKE`，不会把 SDK/HTTP 原文透给渲染层。

## SQLite

路径：`userData/inbox/inbox.sqlite`（macOS `~/Library/Application Support/Grok Bot Anywhere/inbox/`）。

```sql
recipients(account, bot, value JSON, PRIMARY KEY(account,bot))
receipts(id, account, value JSON, PRIMARY KEY(id))
preferences(key, value JSON, PRIMARY KEY(key))
```

- 文件权限 `0600`，目录 `0700`；WAL + `synchronous=FULL`。
- 启动时修复中断状态：`phase=sending` → `unconfirmed/held`；`phase=uploading` → `failed/ready`。
- receipt 里的附件复制到 `inbox/files/<receiptId>/`，数据库只存路径/名称/字节数。
- `sourceDefaults:<accountId>` 存在 preferences 里：`{wechat:{botId,prefix}, whatsapp:{botId,prefix}}`。前缀属于来源，写进正文；Bot 自己的 direct 前缀仍包在外面。

## 投递状态机

```text
receive
  ├─ 无文字/文件             → RECEIPT_EMPTY
  ├─ 来源关闭（非 manual）    → SOURCE_DISABLED
  └─ 建 receipt, needs-input, phase=ready
        │
        ├─ compose 模式 + 无 edit → 等用户（INPUT_REQUIRED）
        └─ process
              ├─ 上传失败/超预算 → failed / ready（可 retry）
              ├─ direct 未开始就超 90s → expired / done
              ├─ 发送抛错(已尝试) → unconfirmed / held（该 Bot 暂停）
              ├─ 结果明确        → sent / done
              └─ 401/403         → 继续抛给上层（触发重新登录）
```

关键规则：

- **同 Bot 串行**：`sendQueues` 按 botId 排队；不同 Bot 可并行。
- **同 Bot 持锁**：存在未 `holdResolved` 的 `unconfirmed` 时，新发送返回 `BOT_SEND_HELD`。
- **direct 截止时间 90s 只决定是否开始**：从 receipt 创建时刻算。开始上传后改用单独的 30 分钟传输预算；100 个附件不会在上传中途因为创建时间过期，传输超预算则回到 `failed/ready`，文件保留、可重试。
- **账号切换**：`assertIdle` 阻止切换期间有 pending/active/inflight；切换 generation 使旧回调失效。
- **`sent` 只表示服务端接受**，不表示 Bot 已读；回复通过 watcher 事件另行挂载。

## 回复挂载

- `watch(botId, sessionId)` 建立 SDK 订阅；断开/切换会取消。
- 新事件挂到该 session 最近一条 `sending`/`sent` receipt；按事件 id 去重并过滤 replay。
- 不承诺“这条回复属于哪一次请求”；这是 SDK 的能力边界，不是 bug。
- `watchErrors` 保留每个 Bot 的订阅错误，UI 显示但不自动重连风暴。

## 分享收件箱

`share-inbox.mjs` 每 0.25 秒扫描 `ShareInbox/Preparing` 和 `ShareInbox/Ready`：

1. 目录名只允许 `[A-Za-z0-9_-]{1,100}`，拒绝符号链接。
2. `manifest.json` 必须版本 1、`source` 为 `wechat` 或 `whatsapp`、账号/投递模式/文件列表合法，大小 ≤8MB。WhatsApp 导出（`_chat.txt` 或含它的 zip）在导入时改记为 `whatsapp`，正文带上 `WhatsApp` 标记和该来源的前缀；原来的菜单来源仍算已开启，所以只打开了微信来源的槽也能收下这份导出。
3. 账号不匹配或切换中：留在 `Ready`，不导入。
4. 已存在同 `sourceId`：移到 `Imported`，不重复。
5. 成功：`session.receive(...)` → 移到 `Imported`；配置类错误保留；其他失败写 `failure.txt` 后移到 `Rejected`。

## 上传

- 单 PUT 从磁盘流式上传；分片模式未实现，遇到会失败且不丢文件。流式上传按字节回报进度，`Delivery` 节流写入 receipt 的 `progress`，输入框收起后的小条据此显示百分比。
- base64 gateway 传输有 64MiB 内存守卫；单请求超时 30 分钟，整条 receipt 的传输预算也是 30 分钟。
- 上传引用只在发送成功后才有意义；失败保留本地文件供 retry。

## 验证

```sh
npm run test:desktop
```

覆盖：状态机、账号隔离、串行发送、未确认持锁、过期、分享 manifest、路径穿越、上传失败、启动恢复。
真实发送/回复链路不在单测里，见 [测试 runbook](../runbooks/test.md) 的“未运行项”。

## 相关

- [收件状态](../reference/receipts.md)
- [数据位置](../reference/configuration.md)
- [ADR 0003：不自动重发](../decisions/0003-no-automatic-retry.md)
- [ADR 0004：本地优先收件箱](../decisions/0004-local-first-inbox.md)
