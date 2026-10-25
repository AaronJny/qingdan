# 青单桌面端

支持 macOS、Windows 和 Linux。打开即可使用，无需安装 Node.js 或运行终端命令。任务与附件保存在本机，也可以连接自己的青单私服。

[下载桌面版](https://github.com/AaronJny/qingdan/releases/latest)

## 安装与升级

- **macOS**：macOS 13 及以上，按处理器选择 Apple Silicon（arm64）或 Intel（x64）版。打开 DMG，将“青单.app”拖入 Applications 后打开。升级前先退出旧版；若仍有旧名 `Qingdan.app`，请移走旧应用，保留数据目录。
- **Windows**：支持 x64。完整解压 ZIP 后运行 `Qingdan.exe`，所有文件应保留在同一目录。
- **Linux**：支持 x64 图形桌面。为 AppImage 添加可执行权限后运行，需要系统支持 Electron 沙箱。不支持 FUSE 时，在空目录执行 `./Qingdan-版本-linux-x64.AppImage --appimage-extract`，再运行 `./squashfs-root/AppRun`。

Ubuntu 24.04 等限制未安装应用使用用户命名空间的系统，可能阻止 AppImage 及其 MCP 进程启动；解压不能消除该限制。请保留系统沙箱保护，不使用禁用沙箱的启动参数。此版本未提供自动调整系统安全策略的安装器。

macOS 版本尚无 Developer ID 签名或 Apple 公证，Windows 版本尚无发布者签名，系统可能阻止运行。遇到安全警告时，请先核实下载来源，保留系统安全设置。

## 本机与私服

本机模式无需登录。连接私服时，打开“文件 → 服务器连接”或按 `Cmd/Ctrl+,`，填写私服 HTTPS 根地址，再用该服务器的账号登录。本机回环地址允许 HTTP。macOS 连接私服时可能请求钥匙串权限，用于保存登录会话。

本机数据与各私服数据分别保存，切换连接不会自动上传或合并。正常退出应用后，下次打开继续使用原有数据。

## 数据与备份

数据目录：

- macOS：`~/Library/Application Support/QingdanDesktop`
- Windows：`%APPDATA%\QingdanDesktop`
- Linux：`${XDG_CONFIG_HOME:-~/.config}/QingdanDesktop`

其中 `local-data` 保存本机任务与附件，其他目录保存设置、登录会话和草稿。私服任务保存在所连接的服务器上。

备份前先退出应用，再复制完整数据目录。升级时只替换应用文件，保留数据目录。备份可能含有个人任务和登录信息，请妥善保管。

## 从源码构建

需要 Node.js 24。在 `application/` 中运行：

```sh
npm ci
npm run check
```

然后在 `desktop/` 中运行：

```sh
npm ci
npm run prepare:backend
npm run verify:backend
npm run check
```

`backend/` 由 `application/` 源码生成，不单独维护。在对应操作系统执行打包命令：

- Windows ZIP：`npm run package:win:zip`
- macOS Apple Silicon DMG 和 ZIP：`npm run package:mac:archives`
- macOS Intel DMG 和 ZIP：`npm run package:mac:x64:archives`
- Linux x64 AppImage：`npm run package:linux:appimage`

更多构建命令和发布配置见 [构建与发布](docs/BUILD-RELEASE.md)。
