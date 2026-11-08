# Notes for coding agents

这个仓库的目标是：**任何 Agent 在没有聊天记录的情况下，也能安全地改对地方、验证、交接。**

## 先读

1. [docs/README.md](docs/README.md) — Wiki 入口与任务路由。
2. [docs/architecture.md](docs/architecture.md) — 进程、数据流、不变量。
3. [LESSONS.md](LESSONS.md) — 已踩过的坑；改代码前读。
4. 与你任务相关的 `docs/subsystems/*.md` 与 `docs/platforms/*.md`。

## 当前状态（2026-11-08）

- 主产品：`desktop/`（Electron），macOS 已验证，Windows 部分实机验证（2026-11-01，开发模式），Linux 未支持。WhatsApp 导出解析已实现；真实 WhatsApp / iPhone 分享菜单未运行。
- 原生：`native/macos/`（Swift），仅 macOS。
- 协议：`packages/client-protocol/`，非官方、实验性。
- 文档：`docs/` 是唯一事实来源；`docs/history/` 只作背景。
- 基线（2026-11-08）：desktop 185 passed（`npm run test:desktop`）。client-protocol 61、avatar 1、Swift 8 为 2026-11-05 / 2026-11-01 基线，本次未重跑。Windows 实机（2026-11-01）：desktop 128 passed + 2 skipped（POSIX-only 断言）、client-protocol 60 passed。
- 根命令：`npm run test:all`、`npm run docs:check`、`npm run smoke`。

## 命令

根 `package.json` 是跨平台命令门面；依赖只装在 `desktop/`，不要在根目录 `npm install`。`make` 目标只是同一组命令的 Unix 快捷方式。

| 目的 | 命令 |
| --- | --- |
| 安装 | `npm run setup`（首次另跑 `npm run setup:submodules`） |
| 构建 UI | `npm run build` |
| 开发 | `npm run dev`（内部剥掉 `ELECTRON_RUN_AS_NODE`） |
| 冒烟 | `npm run smoke`（隔离临时 workspace） |
| Electron 测试 | `npm run test:desktop` |
| Swift 构建/测试 | `npm run test:swift`（macOS） |
| 原生伴侣 | `npm run build:native` |
| 分享扩展 | `npm run build:share` |
| 协议 SDK 测试 | `npm run test:client` |
| 头像测试 | `npm run test:avatar` |
| 全部测试 | `npm run test:all` |
| 文档校验 | `npm run docs:check` |
| 打包 | `npm run package:mac` / `npm run package:win` |

## 仓库地图

```text
package.json              根命令门面（private，无依赖，无 workspaces）
desktop/                  Electron 主产品
  src/main/               主进程与系统集成
  src/service/            唯一写入者：收件库/发送/上传
  src/renderer/           UI（无 Node、无凭据）
  src/share/              macOS 分享槽位与注册
  src/shell/              跨平台纯函数
  test/                   185 tests
native/macos/             Swift 伴侣 + Bloub 头像
packages/client-protocol  非官方 SDK/CLI
docs/                     Wiki（Current / Unverified / Historical）
projects/                 本地项目工作区（默认不入库）
legacy/                   不参与构建的历史代码
scripts/                  文档校验、Agent runner
vendor/bloub              Bloub 头像引擎 submodule
```

## 改哪里

| 想改 | 先读 | 代码 |
| --- | --- | --- |
| 窗口/托盘/快捷键/深链 | [desktop-shell](docs/subsystems/desktop-shell.md) | `desktop/src/main/`、`src/shell/` |
| 收件/发送/状态 | [delivery-service](docs/subsystems/delivery-service.md) | `desktop/src/service/` |
| 主窗口/输入框 UI | [renderer-ui](docs/subsystems/renderer-ui.md) | `desktop/src/renderer/` |
| 分享菜单 | [share-menu](docs/subsystems/share-menu.md) | `desktop/src/share/`、`native/macos/Sources/GrokBotShare` |
| Touch Bar/原生输入框 | [native-companion](docs/subsystems/native-companion.md) | `native/macos/` |
| 协议 SDK/CLI | [client-protocol](docs/subsystems/client-protocol.md) | `packages/client-protocol/` |
| 头像 | [avatar](docs/subsystems/avatar.md) | `desktop/src/renderer/`、`native/macos/avatar/` |
| 打包/签名 | [packaging](docs/subsystems/packaging.md) | `desktop/package.json`、`desktop/scripts/` |

## 不可破坏的规则

1. **不自动重发。** `unconfirmed` 暂停该 Bot，等用户 `resolve`；原 receipt 不重发。见 [ADR 0003](docs/decisions/0003-no-automatic-retry.md)。
2. **不碰真实用户数据。** 测试用临时目录/预览模式；不要读写真实 `userData`、Keychain、`~/.agents`、`~/.claude`。
3. **服务进程是唯一写入者。** 不要在主进程/渲染层写 SQLite 或发送。
4. **渲染层无 Node/凭据。** 新能力走 preload + 主进程白名单。
5. **不把未验证说成已验证。** Windows/Linux 的实机结论必须写“未运行”。
6. **一个事实只写一页。** 改行为时同步更新拥有者页面与 `docs/catalog.json`。

## 平台

- macOS：完整；见 [macOS](docs/platforms/macos.md)。
- Windows：实现存在、**部分实机验证**（2026-11-01，开发模式；安装包与右键点击未运行）；微信分享入口（单入口 + 应用内选择）已实机验证；见 [Windows](docs/platforms/windows.md)。
- Linux：未支持；见 [Linux](docs/platforms/linux.md)。
- 平台分支集中在 `desktop/src/shell/`、`desktop/src/share/`、`native/`，不要散落。

## 完成定义

一个改动只有在以下都满足时才算完成：

1. 行为按目标改变，且没有无关重构。
2. 新增/修改的测试能在旧代码上失败、新代码上通过。
3. 跑过相关套件，并在提交/交接里写明命令、数量、未运行项。
4. 文档拥有者页面更新；`npm run docs:check` 通过。
5. 没有提交构建产物、密钥、真实用户数据。

## 已知陷阱

- `vendor/bloub` 是 submodule：头像构建失败先 `git submodule update --init --recursive`。
- `npm start` 会先 build；直接 `electron .` 会用旧 `out/`。
- 微信会缓存转发菜单：更新后重开微信。
- Windows zip 未签名；SmartScreen/SAC 可能拦截。
- 分享菜单最多 12 行；第 13 个 Bot 用输入框/快捷键。
- 详见 [排障](docs/runbooks/troubleshooting.md)。
