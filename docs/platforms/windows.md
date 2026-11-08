# Windows

状态：Current 代码 + **部分实机验证**（2026-11-01/02，Windows 11 开发模式）。窗口、托盘、协议注册、Explorer 级联、CLI、微信分享入口与 Bot 选择面板已在真机跑过；见[实机验证结果](#实机验证结果2026-11-01)。安装包、右键点击、悬浮输入框焦点仍**未运行**。

## 已实现

| 能力 | 说明 |
| --- | --- |
| 主窗口无边框 | `frame:false` + 自绘最小化/最大化/关闭；去掉应用菜单，补回 `Ctrl+A/C/V/X/Z/Y` |
| 悬浮输入框 | `floatingComposerTraits('win32')`：不进任务栏、置顶、透明、`thickFrame:false` |
| 托盘 | 煤球图标；点击显示主窗口；退出前销毁图标 |
| 全局快捷键 | 默认 `Ctrl+Alt+Space`（可改） |
| URL 协议 | `start "" "grokbotanywhere://open"`；`start "" "grokbotanywhere://send?bot=<id>&text=<text>"`；行为与 macOS 一致 |
| 命令行 | 写 `grok-bot.cmd` + `grok-bot.ps1`；Path 通过 PowerShell 读写 `HKCU\Environment`，写完广播 `WM_SETTINGCHANGE` |
| 应用图标 | `build/icon.ico`；`signExecutable: false` 保留 exe 图标/metadata，仅跳过签名 |
| skills | 复制 skill；Claude Code 用 junction |
| Explorer 右键 | `HKCU\Software\Classes\*\shell\GrokBotAnywhere` 级联，每个启用 Bot 一行 |
| 收件/发送 | 与 macOS 同一套服务进程与 SQLite。拖入或分享 WhatsApp 的 `_chat.txt` / zip 会走同一套解析；此路径未在 Windows 实机运行 |
| 打包 | `npm run package:win` → 未签名 zip；`npm run package:win-store` → 商店 MSIX |

## 微信分享

实机验证：微信 4.1.15 的「转发 → 其他应用」里会显示一个 **Grok Bot** 条目，点开后由应用弹出 Bot 选择面板。与 macOS 的 12 个独立槽位不同，Windows 只有**一个入口**，选哪个 Bot 在应用内完成。

组成：

| 部分 | 说明 |
| --- | --- |
| 稀疏 MSIX | `uap10:AllowExternalContent`，exe 在包外；声明 `windows.shareTarget` 与 `common:runFullTrust` |
| 分享 helper | `native/windows/share-target`，C++/WinRT，读 `StorageItems`/`Text`/`WebLink`，落盘 `%APPDATA%\Grok Bot Anywhere\share-pending\<batch>` 后唤起 `grokbotanywhere://share?batch=` |
| 选择面板 | 无标题栏窗口，宫格 + 动画头像；Enter 发送、双击直发、Esc 关闭并删除批次 |
| 投递 | 按 Bot 的投递模式分流：`compose` 交给悬浮输入框，`direct` 才直接发送 |

清单必须写成腾讯自家分享包那种宽声明（`SupportsAnyFileType` + `StorageItems`/`Text`/`URI`/`Bitmap`），窄声明会被微信宿主在枚举阶段过滤；改完必须杀掉 `Weixin`/`WeChatAppEx` 进程，菜单结果由 `WeChatAppEx` 缓存。

macOS 仍是每个 Bot 一个签名 appex，见[分享菜单](../subsystems/share-menu.md)。

## 分发与签名

两条路，先商店，后侧载：

1. **Microsoft Store（首选，零成本）**：个人开发者账号没有注册费；MSIX 不需要 CA 证书，认证通过后商店用微软证书重签，用户安装零 SmartScreen 警告。步骤、认证说明模板与已知限制见 [Store 提交](../runbooks/store-submission.md)。
2. **侧载分发（zip / MSIX）**：自己解决签名，见下。

侧载签名的优先级：

| 路径 | 成本 | 说明 |
| --- | --- | --- |
| [SignPath Foundation](https://signpath.org/) | 免费 | 公开仓库的开源项目；证书 Subject 属于 SignPath Foundation |
| 商业 OV 证书 | 约 ¥600/年起 | Certum 个人版，国内代理可支付宝；确定性最高 |
| 自签 | 免费 | 仅开发与内网；公共分发会被 SAC 拦 |

**Azure Artifact Signing（原 Trusted Signing）不在选项里。** 它对个人仅开放美国和加拿大，组织仅限美国、加拿大、欧盟、英国；其他地区即使支付成功也过不了身份验证。见[微软的代码签名选项对比](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)。

### SignPath

仓库公开，可以申请 [SignPath Foundation](https://signpath.org/) 的免费开源签名。需要在 SignPath 完成：

1. 申请 Foundation 项目并获批。
2. 建立 project、signing policy、artifact configuration。
3. 安装 SignPath GitHub App，并把 GitHub 作为 trusted build system 关联到 project。
4. 在 GitHub 配置：

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| Secret | `SIGNPATH_API_TOKEN` | 有 submitter 权限的 token |
| Variable | `SIGNPATH_ORGANIZATION_ID` | SignPath organization ID |
| Variable | `SIGNPATH_PROJECT_SLUG` | project slug |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | signing policy slug |
| Variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | artifact configuration slug |
| Variable | `WINDOWS_PUBLISHER` | **必须逐字符等于**签名证书 Subject；MSIX 的 Publisher 不能事后修改 |

`windows-release.yml` 会先上传未签名的 app zip、完整 MSIX、share zip 和稀疏 MSIX，再把这些文件交给 SignPath；artifact configuration 必须覆盖这些文件。签名完成后会输出 `windows-signed` artifact。

当前 workflow 在 `SIGNPATH_PROJECT_SLUG` 未设置时只产出未签名包，不会假装成功签名。

**证书 Subject 与 MSIX Publisher 不一致时，包能签但无法安装。** 本地自签调试用 `new-dev-certificate.ps1`；正式包必须用 SignPath 提供的证书 Subject 填 `WINDOWS_PUBLISHER`。

2026-11-03 的无签名 CI 已经跑通，产物包含 app zip、完整 MSIX、share zip 和稀疏 share MSIX。完整 MSIX 的 share target 与“安装 app + 注册稀疏 share 包”的安装器仍未在 Windows 实机验证；SignPath 项目尚未创建，所以目前只有未签名 artifact。

## 未验证项

- 托盘图标点击与退出菜单。
- 全局快捷键在真机上按下（注册代码已跑通，未按）。
- Explorer 右键菜单项的实际点击与 `--explorer-forward` 端到端投递。
- Explorer 右键在「显示更多选项」中的位置、15 项多选上限。
- 多标签 Explorer 只返回第一个标签选区。
- 常驻 PowerShell 选择宿主：企业安全软件可能告警；编译一次后复用。
- 悬浮输入框的焦点/置顶/点击穿透在多显示器与 DPI 缩放下的表现。
- 安装 zip 后的首次启动、登录、分享导入、通知。
- 打包产物无签名，SmartScreen/SAC 可能拦截。
- Store 包未构建、未上传、未认证；商店版 share target 与 userData 迁移未验证。

## 开发

```powershell
cd desktop
npm ci
npm run build
npm start
```

需要 Node >=22.13。`build:native` / `build:share` 在 Windows 上会直接报错——它们是 macOS 专用。

## 数据位置

`%APPDATA%\Grok Bot Anywhere\`：`inbox\`、`ShareInbox\`、偏好 JSON。
CLI 凭据：`%LOCALAPPDATA%\Grok Bot Anywhere\cli\`。

## 验证（在 Windows 机器上）

1. `npm test`（应通过；这里只证明纯函数）。
2. `npm start`：窗口、托盘、快捷键、输入框、拖放。
3. `start "" "grokbotanywhere://open"`。
4. 设置 → 工具箱 → Windows 菜单 → 重建；在 Explorer 右键验证每个 Bot 一行。
5. `npm run package:win`，解压到干净目录再启动。
6. 记录每一步的实际结果；未运行就写“未运行”，不要写“应该可以”。

## 实机验证结果（2026-11-01）

Windows 11、Node v22.22.0、开发模式（`npm run dev`，非 `--preview`）。只记录实际跑过的项。

| 项 | 结果 | 证据 |
| --- | --- | --- |
| `npm run setup` + `npm run build` | 通过 | 287 包；`desktop/out/` 六个产物 |
| Electron 启动与主窗口 | 通过 | 无边框窗口渲染出真实 Bot 列表与详情 |
| `grokbotanywhere://` 注册 | 通过（读取） | `HKCU\Software\Classes\grokbotanywhere\shell\open\command` 指向 electron.exe + app 目录 + `%1` |
| Explorer 级联注册 | 通过（结构） | 父键 `*\shell\GrokBotAnywhere`（`MUIVerb=Grok Bot`、`ExtendedSubCommandsKey=GrokBotAnywhere.Menu`、`MultiSelectModel=Document`），子键 `01_<botId>` 的 command 形如 `--explorer-forward --bot=<id> -- "%1"`；只注册 enabled 的 Bot |
| `npm test`（desktop） | 128 通过 / 2 跳过（共 130） | 跳过的两项是 POSIX-only 断言（rc 文件、ENOTDIR） |
| `npm run test:client` | 60 通过 | — |
| 随包 `grok-bot.cmd --version` | 通过 | `grok-bot 0.3.0` / `grok-bot-target 0.78.1` / `runtime node v22.22.0` |

实机发现并已修复（见 [LESSONS](../../LESSONS.md)）：`core.autocrlf=true`（Git for Windows 默认）会把 `bin/grok-bot.mjs` 检出成 CRLF，使随包校验失败，**Windows 上 `grok-bot` 的所有调用都以 `CLI_CHECKSUM_MISMATCH` 退出 3**。`.gitattributes` 已把 `desktop/resources/grok-bot-skill/**` 标为 `-text`。

## 已知风险

- 微信分享目标需要 MSIX/包标识；自签名在 Smart App Control 开启时大概率被拦。见 [ADR 0005](../decisions/0005-platform-boundaries.md)；本地验证包在 `projects/windows-share/`（默认不入库）。
- **完整 MSIX 下经典 Explorer 右键菜单预计失效**：菜单写入 `HKCU\Software\Classes`，打包应用对该键的写入被 MSIX 虚拟化到包内，资源管理器枚举不到。商店版需要改用 `windows.fileExplorerContextMenus`（仅 Windows 11）或接受裁剪。未实机确认。
- 商店版 `%APPDATA%` 被重定向到包私有目录，zip 版用户升级后不会带过登录态与收件库。
- 无边框窗口的最大化内缩依赖 `anywhere:window-state` 的工作区 inset；多显示器/DPI 缩放未验证。

## 相关

- [桌面外壳](../subsystems/desktop-shell.md)
- [Store 提交](../runbooks/store-submission.md)
- [Windows 覆盖历史文档](../history/legacy/windows-coverage.md)
- [构建](../runbooks/build.md)
