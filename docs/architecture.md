# 系统架构

状态：Current。最后核对：2026-11-08。

## 一句话

把用户此刻看到的上下文（选中的文件、微信转发、快捷指令、随手一句话）交给指定的 Grok Bot，并保证**内容先落地、发送可追溯、结果不明确时停下来**。同一套协议跑在 macOS / Windows 的 Electron 外壳里，macOS 额外有一个 Swift 原生伴侣补 Touch Bar、原生输入框、语音和微信分享扩展。

## 进程拓扑

```text
Electron main (desktop/src/main/main.mjs)
├─ BrowserWindow 主窗口          out/index.html          renderer/app.mjs
├─ BrowserWindow 悬浮输入框       out/composer.html       renderer/composer.mjs
├─ BrowserWindow 头像窗           out/composer.html?part=avatar
├─ BrowserWindow Tab 宫格         out/composer.html?part=picker
├─ utilityProcess 服务            src/service/worker.mjs
│   └─ SQLite inbox.sqlite + 上传 + 发送队列 + 分享收件箱 drain
├─ Native companion (macOS)       native/macos → desktop/native/GrokBotCompanion.app
└─ Share extensions (macOS)       desktop/native/GrokBotMenuHost.app + 12 appex
```

- **主进程**只做窗口、系统集成、IPC 白名单和编排；不直接持有 Bot 凭据以外的业务状态。
- **服务进程**是唯一拥有收件库、发送队列和 SDK 客户端的地方。主进程通过 `RpcClient`（`src/main/rpc.mjs`）发 JSON 请求，通过 `anywhere:event` 推状态。
- **渲染进程**没有 Node 集成、没有凭据。`preload.cjs` 暴露 `call`、事件订阅、窗口控制等有限方法；主进程 `trusted()` 校验发送者是四个本地窗口之一的主 frame。
- **原生伴侣**只在 macOS 启动，通过 stdin/stdout NDJSON 通信；它不读账号凭据，不联网发消息，所有发送都回到服务进程。见 [原生伴侣](subsystems/native-companion.md)。

## 数据流

### 1. 从外部入口进来

| 入口 | 路径 | 第一落点 |
| --- | --- | --- |
| 系统分享 / WhatsApp（macOS） | 同一个分享扩展把 ZIP、`_chat.txt`、文本或媒体复制到 `ShareInbox/Ready/<id>/` | 服务进程 `ShareInbox.drain()`；WhatsApp 导出在这里识别，其余记为通用来源 |
| 快捷指令 / URL | `grokbotanywhere://compose|send` | 主进程深链解析 → 服务 `receive` |
| Explorer 右键（Windows） | `--explorer-forward --bot=<id> -- <file>` | 主进程 `parseExplorerForward` → 服务 `receive` |
| 悬浮输入框 | 全局快捷键 / 托盘 / `composer.open` | 主进程 `openComposer` → 用户确认后 `sendDraft` |
| 拖放 | 主窗口 Bot 卡片 / 输入框 | 主进程 `intake` → 服务 `receive` |

所有入口最终都调用服务进程的 `receive`，生成一条 **receipt**。内容先复制进 `userData/inbox/files/<receiptId>/`，再决定 `compose` 还是 `direct`。

### 2. 投递

`Delivery.receive` 校验来源开关、文件、账号范围，写 SQLite；`process` 依次：

1. 上传文件（`uploadFile`，返回服务端引用）。
2. 需要用户补字时停住（`needs-input`，compose 模式）。
3. 用稳定 `messageId` 调 `sendMessage`。
4. 结果明确 → `sent`；不明确/超时 → `unconfirmed` 并持锁；上传失败/超传输预算 → `failed`；direct 创建后 90 秒内仍未开始 → `expired`。

同一 Bot 的发送串行化；切换账号或 Bot 不会改变已经冻结的 receipt 目标。详见 [投递服务](subsystems/delivery-service.md) 和 [收件状态](reference/receipts.md)。

### 3. 回复

服务进程为每个 Bot/session 维持 `watch`；SDK 给出的是 Bot/session 的完整文本 upsert，不是按请求关联的回复。新事件挂到该 session 最近一条发送中/已发送的 receipt，replay 过滤；不承诺“这条回复对应哪次请求”。回复只进通知和收件页，不写回微信。

## 仓库分层

| 层 | 目录 | 可以依赖 | 不可以依赖 |
| --- | --- | --- | --- |
| 跨平台产品 | `desktop/` | `grok-bot-sdk`、Node/Electron 内置、`native/` 产物 | 不反向依赖 `native/macos` 源码 |
| macOS 原生 | `native/macos/` | Swift、AppKit、系统框架 | 不读 Electron ASAR；不直接发消息 |
| 协议工具 | `packages/client-protocol/` | Node 内置 | 不依赖 Electron / Swift |
| 历史调研 | `legacy/bridge/` | 独立 | 不参与构建 |
| 命令门面 | `package.json`、`scripts/run.mjs` | 只转发 `npm` 命令 | 不装依赖；不用 workspaces |
| 一次性交付 | `projects/` | 任意 | 不进产品运行时 |
| 文档 | `docs/` | 只描述代码 | 不承载运行逻辑 |

## 关键不变量

1. **单一写入者**：收件库、凭据、发送队列只由服务进程写；主进程不写 SQLite。
2. **先落地再联网**：任何入口都先产生本地 receipt/文件，网络失败不丢内容。
3. **结果不明确 ≠ 失败**：`unconfirmed` 会暂停该 Bot，禁止自动重发；用户 `resolve` 后才解锁。
4. **账号隔离**：receipt、recipient、分享批次都带 `accountId`；账号变化清空原生草稿与绑定。
5. **渲染层无权限**：渲染进程拿不到 Node、token、文件系统；所有动作走白名单 IPC。
6. **平台差异止于边界**：`shell/actions.mjs`、`share/`、`native/` 吸收平台差异；业务逻辑保持可移植。

## 跨平台现状

- **macOS**：完整路径已实机验证（见 [macOS](platforms/macos.md)）。
- **Windows**：Electron 路径实现并在 macOS 上跑单测，但没有 Windows 实机证据；微信没有等价的分享扩展宿主。见 [Windows](platforms/windows.md)。
- **Linux**：没有打包目标；Electron 理论可跑，但浮窗、全局快捷键、托盘未验证。见 [Linux](platforms/linux.md)。

## 相关页面

- [术语表](glossary.md)
- [桌面外壳](subsystems/desktop-shell.md)
- [投递服务](subsystems/delivery-service.md)
- [打包与签名](subsystems/packaging.md)
- [ADR 0001：Electron 作为主外壳](decisions/0001-electron-over-swift.md)
