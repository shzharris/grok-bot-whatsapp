# 收件（receipt）状态

状态：Current。实现：`desktop/src/service/delivery.mjs`。

## 字段

| 字段 | 含义 |
| --- | --- |
| `id` | receipt UUID |
| `accountId` / `botId` / `botName` / `sessionId` | 冻结的投递目标 |
| `source` | `whatsapp` / `shortcuts` / `share` / `drop`。分享扩展的 manifest 仍写 `wechat`，导入时并进 `share`，除非识别为 WhatsApp |
| `sourceTag` | 识别为 WhatsApp 导出时为 `WhatsApp`；其它来源没有这个字段 |
| `text` / `title` | 正文与可识别标题（微信 ZIP 等） |
| `files[{path,name,bytes}]` | 本地副本；`path` 不离开服务进程 |
| `mode` | `compose` 或 `direct`（创建时冻结） |
| `prefix` | direct 模式的前缀 |
| `messageId` | 稳定发送 id；重试复用，避免重复 |
| `status` / `phase` | 用户可见状态 / 内部阶段 |
| `error` | 稳定错误码 |
| `progress` | 发送小条用的阶段进度：`{stage:'upload'|'send'|'done', name, bytes, totalBytes, index, total, percent}` |
| `sourceId` | 去重键（分享批次 `wechat:<batchId>` 或 `whatsapp:<batchId>`） |
| `replies[]` | 该 receipt 收到的回复事件 |
| `sentAt` / `delivery` | 明确成功后的时间与服务端投递信息 |
| `holdResolved` | 用户已核对，解除该 Bot 的暂停 |
| `composerDismissed` | 用户主动关闭输入框后标记；附件已清空，启动时不再自动弹出 |

## 状态

| status | phase | 含义 | 下一步 |
| --- | --- | --- | --- |
| `needs-input` | `ready` | 已落地，等用户补字/确认（compose） | `submit` |
| `failed` | `ready` | 上传/发送明确失败，文件保留 | `retry`（用户） |
| `unconfirmed` | `held` | 尝试过但结果不明；该 Bot 暂停 | 去官方客户端核对 → `resolve` |
| `sent` | `done` | 服务端接受（≠ 已读） | 等回复/结束 |
| `expired` | `done` | direct 创建后超过 90 秒仍未开始处理 | 重新创建，不自动补发 |

## 迁移

```text
receive ──► needs-input
              ├─ submit(compose) ──► 上传 ──► 发送 ──► sent
              ├─ direct 自动 ──────► 上传 ──► 发送 ──► sent
              ├─ 上传失败/超预算 ─► failed ──retry──► 上传…
              ├─ 发送抛错(已尝试) ─► unconfirmed ──resolve──► 保持原状态，解锁 Bot
              └─ 未开始就超 90s(direct) ─► expired
```

- 启动恢复：`phase=sending` → `unconfirmed/held`；`phase=uploading` → `failed/ready`。
- `resolve` 不会重发原 receipt，只设置 `holdResolved` 并释放 Bot。
- 同一 Bot 存在任一 `unconfirmed` 且未 `holdResolved` 时，新发送返回 `BOT_SEND_HELD`。
- 删除 receipt 不会撤回已发送的消息。

## 回复

- 回复是 Bot/session 事件，不是请求关联结果。
- 只有该 session 最近一条 `sending`/`sent` receipt 会接收；旧事件按 id 过滤。
- `replies[]` 只做展示/通知，不回写微信。

## 相关

- [投递服务](../subsystems/delivery-service.md)
- [术语](../glossary.md)
- [ADR 0003](../decisions/0003-no-automatic-retry.md)
