# 桌面外壳（Electron main）

状态：Current。平台：macOS 已验证；Windows 实现未实机验证；Linux 未支持。

## 职责

`desktop/src/main/main.mjs` 是唯一的主进程入口，负责：

- 创建主窗口、悬浮输入框、头像窗、Tab 宫格，并安排它们的位置。
- 托盘、Dock、全局快捷键、登录项、单实例、`grokbotanywhere://` 深链。
- 启动并守护 utility process（服务进程），转发 `anywhere:call`。
- 账号动作（登录/退出/切换）、凭据保险箱、CLI 安装、分享菜单同步。
- macOS 原生伴侣的启动与 RPC 转发。
- Windows Explorer 右键注册与 `--explorer-forward` 解析。

它**不**直接发送消息、不写 SQLite、不解析 Bot 名单——这些在服务进程。

## 源码入口

| 文件 | 作用 |
| --- | --- |
| `desktop/src/main/main.mjs` | 主进程全部系统集成 |
| `desktop/src/main/rpc.mjs` | 主进程 ↔ 服务进程 JSON RPC |
| `desktop/src/main/companion.mjs` | 启动原生伴侣、转发 NDJSON 请求 |
| `desktop/src/main/share-menu.mjs` | 分享菜单宿主安装/更新状态 |
| `desktop/src/main/cli-bridge.mjs` | `grok-bot` 命令与 skill 安装 |
| `desktop/src/main/credentials.mjs` | safeStorage 保险箱 |
| `desktop/src/main/selection.mjs` | Finder / Explorer 选区读取（Windows 常驻 PowerShell） |
| `desktop/src/shell/actions.mjs` | 纯函数：窗口关闭策略、托盘模型、快捷键、Explorer 注册表、登录项 |
| `desktop/src/shell/window-chrome.mjs` | 主窗口选项、Windows 自绘标题栏、编辑快捷键 |
| `desktop/src/shell/deeplink.mjs` | 深链解析、来源开关检查 |
| `desktop/src/shell/coal-ball.mjs` | 应用图标、托盘/任务栏煤球图标 |

## 窗口

| 窗口 | 尺寸/位置 | 说明 |
| --- | --- | --- |
| 主窗口 | 系统默认，最小尺寸见 `mainWindowOptions` | 关闭（红点或 `Cmd+W`）时有托盘则隐藏并隐藏 Dock 图标；无托盘才退出 |
| 悬浮输入框 | 368×120，默认贴当前屏幕底部 | 透明、置顶、可点击穿透；顶部把手可拖动，拖动后保持位置；失焦可配置是否收起 |
| 头像窗 | 104×104（内部 88×88 头像 + 8px 阴影留白） | 显示当前 Bot 头像，带轻微投影；macOS 上作为输入框的子窗口随原生拖动移动 |
| Tab 宫格 | 760×188 | 最多 10 列 × 2 行，键盘 1–0 / − + / 方向键 / Tab / Esc；macOS 上同样作为子窗口跟随 |

macOS 使用 `hiddenInset` + vibrancy；Windows 使用 `frame:false` + 自绘最小化/最大化/关闭（仅主窗口），并补回 `Ctrl+A/C/V/X/Z/Y`。Linux 走 Electron 默认路径，未验证。

macOS 的头像窗和宫格是输入框的 AppKit 子窗口，拖动时由系统一起移动。不要再在 `move` 事件里逐帧 `setBounds`：原生拖拽循环会节流 JS，头像会明显落后于卡片。Windows 暂保留事件驱动布局，待实机验证子窗口跟随。

## 托盘与后台

- 托盘菜单和「文件」菜单按界面语言生成，至少包含：显示主窗口、打开输入框、退出。界面语言存在服务进程的 `language` 偏好里；缺省是跟随系统。编辑和窗口菜单仍用系统角色，跟随操作系统。通知也用同一套界面语言。
- 主窗口关闭后隐藏，进程继续收分享/快捷键；托盘不存在时关闭即退出。
- 登录项只在打包构建写入系统；开发模式只保存偏好，不注册裸 Electron。
- 从登录项启动时保持后台，不弹主窗口。
- 主窗口隐藏后 Dock 图标隐藏（`app.setActivationPolicy('accessory')`）；托盘、深链或重新显示主窗口时恢复。
- 唤醒悬浮输入框只显示浮窗，不打开主窗口；应用激活事件的处理器会跳过浮窗可见或正在唤起的状态。
- 唤醒前先用 `lsappinfo` 判断前台 App；只有 Finder 在最前时才读 Finder 选区，避免每次都等 AppleScript 超时。重复的 Dock 显示/隐藏调用也按状态跳过。
- 主窗口隐藏时，外部分享/深链一进入就切到 accessory 模式并在显示浮窗前后再次隐藏 Dock，避免图标闪一下。

## 全局快捷键

- 默认 `Control+Option+Space` 打开输入框；可在设置里改。
- 快捷键在服务进程状态更新后重建；账号切换/退出时先注销。
- 原生伴侣存在时，Touch Bar 由伴侣负责；主进程只转发状态和 pin 请求。
- 渲染层请求 `suppressShortcuts` 时临时注销（例如正在录制快捷键）。

## 深链

`grokbotanywhere://open|compose|send`：

- `open` 显示主窗口。
- `compose?bot=<id>` 打开输入框；带 `text` 时只在已登录、Bot 存在、该 Bot 的 Shortcuts 来源开启时预填。
- `send?bot=<id>&text=<text>` 与 compose 同样的检查，但永远只预填，不自动发送。
- 链接不携带 token；冷启动不因链接强制弹主窗口。

细节见 [URL 协议](../reference/deeplinks.md)。

## 单实例与 Windows Explorer

- 第二个实例把原始 `process.argv` 通过 single-instance payload 交给第一个实例；Chromium 会重排 argv，所以 `parseExplorerForward` 不能依赖 `--bot` 的下一个参数，必须按参数形状解析。
- Explorer 菜单只列 `enabled` 的 Bot，按设置顺序；父键 `HKCU\Software\Classes\*\shell\GrokBotAnywhere`，子键 `...\GrokBotAnywhere.Menu\shell\01_<botId>`。
- 注册表先写新树再删旧父键；失败回滚本次创建的键；关闭功能只删自己的键。
- 每次拒绝写一行脱敏日志到 `userData/logs/explorer-forward.log`。
- 未验证：Windows 11 新菜单里的位置、15 项多选上限、多标签 Explorer 只返回第一个标签的选区。

## CLI 与 skill

设置里的开关会：

1. 把 `grok-bot` 命令装到用户目录（Windows 写 `.cmd` + `.ps1`，macOS 写可执行 shim）。
2. 复制随包的 skill；Claude Code 用 junction/软链接入。
3. 另存一份明文登录到 `userData/cli`（Windows `%LOCALAPPDATA%\Grok Bot Anywhere\cli`），供 Electron 外调用；退出登录或关闭开关时删除。

已存在且不是本应用装的命令/skill 不会被覆盖，返回 `CLI_COMMAND_EXISTS`。

## 安全边界

- 渲染进程：无 Node、无 token；所有 IPC 先过 `trusted(event)`，只接受四个本地窗口的主 frame。
- 主窗口 `sandbox`/`contextIsolation` 配置见 `mainWindowOptions`；preload 只暴露白名单方法。
- 登录 token 走 Electron `safeStorage`；CLI 副本是**明文**，只在用户主动开启时存在。
- 预览模式 `--preview` 用临时 userData，不恢复账号、不注册快捷键、不发送。

## 验证

```sh
cd desktop
npm test                 # 包含 shell-actions / window-chrome / deeplink / shortcut 用例
npm run smoke            # Electron UI + 本地收件，截图到 artifacts/
npm run smoke:native     # 需要 macOS 原生伴侣
```

未验证：Windows 实机、Linux、真实 Touch Bar 硬件。

## 相关

- [渲染层](renderer-ui.md)
- [投递服务](delivery-service.md)
- [Windows](../platforms/windows.md)
