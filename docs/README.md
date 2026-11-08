# Grok Bot Anywhere — 项目 Wiki（LLM 入口）

这是本仓库唯一的文档入口，写给接手维护的 Agent 和人类。目标：不用先读代码，也能在 10 分钟内知道**这是什么、代码在哪、改哪里、怎么验证、哪些结论还没被验证**。

## 先读什么

| 你的任务 | 阅读顺序 |
| --- | --- |
| 第一次接手 | 本页 → [架构](architecture.md) → [仓库地图](#仓库地图) → [术语](glossary.md) |
| 改 Electron 主窗口 / 托盘 / 快捷键 | [桌面外壳](subsystems/desktop-shell.md) → [渲染层](subsystems/renderer-ui.md) |
| 改收件、发送、状态机 | [投递服务](subsystems/delivery-service.md) → [收件状态](reference/receipts.md) |
| 改 macOS 分享菜单 | [分享菜单](subsystems/share-menu.md) → [macOS](platforms/macos.md) |
| 改 Touch Bar / 原生输入框 / 语音 | [原生伴侣](subsystems/native-companion.md) → [原生协议](reference/native-protocol.md) |
| 改协议 SDK / CLI | [Client Protocol](subsystems/client-protocol.md) → [CLI](reference/cli.md) |
| 出头像问题 | [头像](subsystems/avatar.md) |
| 打包、签名、公证 | [打包与发布](subsystems/packaging.md) → [发布 runbook](runbooks/release.md) |
| 上架 Microsoft Store | [Store 提交](runbooks/store-submission.md) → [Windows](platforms/windows.md) |
| 在 Windows 上开发/验证 | [Windows](platforms/windows.md) → [换平台前必读](decisions/0005-platform-boundaries.md) |
| 看最新版本改了什么 | [0.1.4 更新说明](updates/0.1.4.md) |
| 查历史设计 | [docs/history](history/)（只作背景，不作现状） |

## 仓库地图

```text
package.json             根命令门面（private、无依赖、无 workspaces）
desktop/                 Electron 应用（macOS / Windows 主产品）
  src/main/              主进程：窗口、托盘、快捷键、深链、CLI、分享同步
  src/service/           独立 utility process：账号会话、收件库、投递、上传
  src/renderer/          主窗口、悬浮输入框、Tab 宫格、头像页
  src/share/             macOS 分享菜单模型、槽位、注册、顺序
  src/shell/             跨平台纯函数：窗口选项、托盘模型、深链、Explorer 转发
  test/                  183 个 Node 测试
native/macos/            Swift 原生伴侣（Touch Bar、原生输入框、语音、分享扩展宿主）
  Sources/               Swift Package 源码
  avatar/                Bloub 离线头像渲染源码
packages/client-protocol 非官方 Grok Bot 协议 SDK / CLI（Node，零依赖）
docs/                    本 Wiki；现行文档在顶层与 subsystems/，历史在 history/
projects/                本地项目工作区（默认不入库），不属于产品运行时
  rokid-2026/            Rokid AIUI 作品策划案（已交付 PDF）
  windows-share/         Windows 分享入口调研与验证包（未实机验证）
legacy/bridge/           早期 SDK 调研环境，不参与构建
scripts/                 repo 级工具：文档校验、Agent 任务 runner
vendor/bloub             头像引擎上游源码（git submodule）
```

## 命令

根目录的 `npm run ...` 是跨平台入口；`make` 只是同一组命令的 Unix 快捷方式。依赖只在 `desktop/`，不要在根目录 `npm install`。

```sh
npm run setup          # desktop 依赖
npm run dev            # 构建 + 启动
npm run smoke          # 隔离冒烟
npm run test:all       # desktop + client + avatar + swift
npm run docs:check
```

为什么这样分层见 [ADR 0006](decisions/0006-root-command-facade.md)。

## 当前状态（2026-11-08）

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| macOS | 主平台，已实机验证 | 登录、名单、悬浮输入框、12 槽分享菜单、收件与发送均跑过。WhatsApp 导出解析已实现，真实分享菜单未运行 |
| Windows | 已实现，**未实机验证** | 无边框窗口、Explorer 右键、悬浮输入框、CLI、URL 协议；微信分享入口不支持 |
| Linux | 未支持 | 没有打包目标与平台适配，见 [Linux](platforms/linux.md) |

## 三条硬规则

1. **不要自动重发。** 投递结果不明确时进入 `unconfirmed` 并暂停该 Bot，等用户核对后 `resolve`。见 [投递服务](subsystems/delivery-service.md)。
2. **不要动真实用户数据。** 测试用临时目录；不要读写 `~/Library/Application Support/Grok Bot Anywhere`、真实 Keychain、真实 `~/.agents`。见 [测试规范](standards/testing.md)。
3. **一个事实只写一页。** 改行为时，同步改拥有该事实的页面；不要在多处复制。见 [文档规范](standards/docs.md)。

## 怎么验证

最短路径：

```sh
npm run test:desktop           # 183 tests
cd native/macos && swift build  # macOS only
cd packages/client-protocol && npm test
node --test native/macos/avatar/renderer.test.mjs
```

完整命令、平台前置条件与“哪些没跑”的写法，见 [测试 runbook](runbooks/test.md)。

## 机器可读索引

- [docs/catalog.json](catalog.json)：页面 id、路径、摘要、标签、状态。校验：`node scripts/check-docs.mjs`。
- [llms.txt](../llms.txt)：给外部 LLM 抓取的精简入口。

## 文档约定

- **Current**：描述当前代码行为，必须能指到源码。
- **Unverified**：代码已实现但没有实机/真实账号证据，必须显式标注。
- **Historical**：`docs/history/` 下的计划、调研、报告；可以过时，不作现状引用。
- **Proposed**：提案放 issue 或 `projects/`，不要混进 Current 页面。

每页开头用一行 `状态：` 标出属于哪类；没有标注的按 Current 处理。
