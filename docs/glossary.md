# 术语表

状态：Current。只在这里解释一次；其他页面直接链接过来。

| 术语 | 含义 | 代码位置 |
| --- | --- | --- |
| **Bot** | 用户账号下的一个 Grok 智能体，有名字、头像、长期对话。身份主键是 UUID（`agentId`/`id`），不是数字 id。 | `desktop/src/service/session.mjs` |
| **主 Bot** | 账号设置里标记为主 Bot 的那一个，UI 显示星标；不改变投递语义。 | `runtime.mainAgentId` |
| **接收单位 / recipient** | 某个 Bot 是否允许接收入口内容，以及收到后怎么处理。按 `(accountId, botId)` 存。 | `src/service/store.mjs` `recipients` |
| **来源 / source** | `wechat`、`whatsapp`、`shortcuts`、`share`、`drop`，可分别开关。 | `store.mjs` `SOURCES` |
| **来源默认** | 每个来源一个默认 Bot 和一段前缀。分享菜单里点哪个 Bot 仍交给哪个；默认 Bot 会打开对应来源。 | `source-defaults.mjs` |
| **receipt / 收件** | 一条交办记录：来源、文字、文件、目标 Bot、当时的投递模式、状态。 | `delivery.mjs` |
| **compose 模式** | 收到后先放进悬浮输入框，用户补字再发。默认模式。 | `recipient.mode` |
| **direct 模式** | 收到后直接上传并发送；可加固定前缀。 | `recipient.mode` |
| **needs-input** | receipt 已落地，等用户补充/确认后发送。 | `receipt.status` |
| **sent** | 服务端已明确接受投递。**不等于 Bot 已读或已回复。** | `receipt.status` |
| **unconfirmed** | 发送已经尝试，但结果不明确（超时/网络错误/未知 ack）。该 Bot 暂停新发送，等用户核对。 | `receipt.status` + `phase=held` |
| **failed** | 上传或发送明确失败，可重试；文件保留。 | `receipt.status` |
| **expired** | direct receipt 创建后超过 90 秒仍未开始处理，不再自动发；已开始上传的不按此时间中断。 | `delivery.mjs` |
| **resolve / 已核对** | 用户到官方客户端确认后解除 `unconfirmed` 锁定；原 receipt 不会重发。 | `session.resolve` |
| **share slot** | macOS 上 12 个预建的分享扩展槽之一，一个槽对应一个接收 Bot。 | `src/share/model.mjs` |
| **share host** | `~/Applications/Grok Bot Anywhere Menu` 下的宿主 App，承载 12 个 appex。 | `src/share/host-path.mjs` |
| **ShareInbox** | 分享扩展写入的本地目录：`Ready → Staging → Imported/Rejected`。扩展无网络权限。 | `src/service/share-inbox.mjs` |
| **native companion** | macOS 的 Swift 伴侣进程，负责 Touch Bar、原生输入框、语音、Finder 选区。 | `native/macos/` |
| **app bridge** | Swift 独立模式通过 NDJSON 调用的 Node 协议桥；Electron 模式下不用。 | `packages/client-protocol/app-bridge.mjs` |
| **CLI 凭据副本** | 为了 `grok-bot` 命令在 Electron 外运行，单独存的一份明文登录；退出登录/关闭开关时删除。 | `src/main/cli-bridge.mjs` |
| **preview** | `npm start -- --preview` 的隔离示例工作区，不能发送，用临时 userData。 | `main.mjs` 顶部 |
| **smoke** | Electron UI 冒烟：`npm run smoke`，截图写到 `desktop/artifacts/`。 | `package.json` |
| **staple** | 把 Apple 公证票据钉进 `.app`/DMG，离线也能通过 Gatekeeper。 | `runbooks/release.md` |

## 容易混淆的几组

- **投递成功 ≠ Bot 已读**：`sent` 只表示服务端接受。回复是另一条事件流，见 [投递服务](subsystems/delivery-service.md)。
- **关闭接收 ≠ 删除数据**：关掉 recipient 只停止新内容进入；已有 receipt 和文件仍在本地，直到用户清理。
- **关闭分享菜单某一槽 ≠ 重签整包**：只改显示/启用；改名字、头像、增删 Bot 才需要重建宿主。见 [分享菜单](subsystems/share-menu.md)。
- **分享扩展失败 ≠ 内容丢失**：无法导入的批次留在 `Ready` 或移到 `Rejected`，文件保留。
