# macOS

状态：Current。主平台，绝大多数路径已实机验证。

## 前置条件

- macOS 14+（`.app` 最低 14.0；Swift Package 平台 `.macOS(.v14)`）。
- Xcode Command Line Tools（`xcode-select -p`）；Swift 6 工具链。
- Node >=22.13、npm。
- 可选：真实 Touch Bar 机型（验证 Touch Bar 交互）。

检查环境：

```sh
native/macos/scripts/check-environment.sh
```

## 从零构建

```sh
git clone --recurse-submodules <repo>
cd <repo>
npm run setup
npm run build
npm run build:native    # Swift 伴侣
npm run build:share     # 微信分享宿主 + 12 槽
npm start
```

头像构建由 `build:native`/`build-avatar` 触发；它依赖 `vendor/bloub` submodule 与 `desktop/node_modules/esbuild`。

## 已实机验证

- 浏览器登录、本机登录、Bot 名单、头像。
- 悬浮输入框、Tab 宫格、全局快捷键。
- 微信转发菜单：2+ 接收 Bot、12 槽、ZIP/文本/媒体导入、收件状态。
- 收件 → 发送 → 回复挂载；`unconfirmed` 持锁与 `resolve`。
- 原生伴侣：共享名单、原生输入框、草稿保护、Touch Bar 选择。
- `Cmd+W` 关闭主窗口后进程继续运行，Dock 图标隐藏；从托盘或深链重新打开主窗口时恢复。
- App/Dock 图标为黑煤球：1024px 画布、824px 内容安全区、四周 100px 透明边；状态栏图标不变。
- 快捷指令的 UI 入口暂时隐藏：Bot 详情的「快捷指令」来源 chip 和「复制快捷指令链接」行不显示；后端深链仍保留。
- DMG 签名 + 公证 + staple。

## 未验证 / 需人工

- 真实 Touch Bar 硬件的滑动惯性、重复点击。
- 麦克风/语音识别权限拒绝路径与识别质量。
- 每台机器、每个微信版本的菜单位置与缓存行为。
- WhatsApp for Mac 的系统分享，以及 iPhone 导出后传到 Mac 的 `_chat.txt` / zip。解析、导入和文件夹监视有单测；真实分享菜单、真实下载文件夹和系统文件夹选择器未运行。
- 界面语言切换后的真实窗口、托盘、通知和系统分享菜单标题。解析和设置文案有单测；Electron 窗口未运行。
- App Intents（当前没有；用 URL 协议替代）。
- 系统登录项在真实重启后的行为（打包构建才写入）。

## 权限

| 权限 | 触发 |
| --- | --- |
| 辅助功能 / Apple Events | 读取 Finder 当前选区；首次会弹系统授权 |
| 麦克风 | 第一次开始语音输入 |
| 语音识别 | 第一次语音输入；优先设备端中文 |
| 通知 | 收到 Bot 回复 |
| 文件访问 | 用户主动选文件/拖放 |

## 数据位置

`~/Library/Application Support/Grok Bot Anywhere/`：`inbox/`、`ShareInbox/`、`cli/`、`composer-prefs.json`、`share menu state`。凭据在系统 Keychain + safeStorage。详见 [配置与数据位置](../reference/configuration.md)。

## 分享菜单

宿主安装到 `~/Applications/Grok Bot Anywhere Menu/Contents/Helpers/DestinationNN.app`（普通文件夹；嵌在另一个 App 里会导致系统返回占位图标）。更新后重开微信。详见 [分享菜单](../subsystems/share-menu.md)。

## 验证

```sh
npm run test:desktop
cd native/macos && swift build && ./scripts/test.sh
npm run smoke && npm run smoke:native
```

## 相关

- [构建](../runbooks/build.md)
- [发布](../runbooks/release.md)
- [排障](../runbooks/troubleshooting.md)
