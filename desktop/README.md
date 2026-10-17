# 青单桌面端

支持 macOS、Windows 和 Linux。打开应用即自动启动内置服务，无需安装 Node.js 或运行终端命令；任务与附件保存在本机，也可以连接自己的青单私服。

## 安装与使用

- **macOS**：支持 Apple Silicon、macOS 13 及以上。打开 DMG，将“青单.app”拖入 Applications 后打开。升级前先正常退出旧版；如果仍有旧名 `Qingdan.app`，请移走旧应用，保留 `QingdanDesktop` 数据目录。
- **Windows**：支持 x64。完整解压 ZIP 后运行 `Qingdan.exe`，所有文件应保留在同一目录。
- **Linux**：支持 x64 图形桌面。为 AppImage 添加可执行权限后运行，需要系统能正常启用 Electron 沙箱。不支持 FUSE 时，可在空目录执行 `./Qingdan-版本-linux-x64.AppImage --appimage-extract`，再运行 `./squashfs-root/AppRun`。

macOS 版本尚无 Developer ID 签名或 Apple 公证，Windows 版本尚无发布者签名，系统可能阻止运行。遇到安全警告时，请先核实下载来源，保留系统安全设置。

本机模式无需账号密码。连接私服时，打开“文件 → 服务器连接”或按 `Cmd/Ctrl+,`，填写私服 HTTPS 根地址，再用该服务器的账号登录。本机回环地址允许 HTTP。

本机数据与各私服数据独立保留，切换连接不会自动上传或合并。正常退出应用会停止内置服务，下次打开继续使用原有数据。

## 数据与备份

用户目录为系统应用数据目录下的 `QingdanDesktop`：

- macOS：`~/Library/Application Support/QingdanDesktop`
- Windows：`%APPDATA%\QingdanDesktop`
- Linux：`${XDG_CONFIG_HOME:-~/.config}/QingdanDesktop`

其中 `local-data` 保存本机数据库与附件，其余目录保存连接设置、会话、缓存和界面草稿。私服任务保存在所连接的服务器上。

备份前先正常退出应用，再复制完整用户目录。升级时只替换应用文件，保留数据目录。备份可能含有个人任务和会话信息，请妥善保管。

## 从源码构建

在 `application/` 中运行：

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

`backend/` 是生成目录，由 `application/` 的当前源码构建，不单独维护。

在对应操作系统执行打包命令：

- Windows ZIP：`npm run package:win:zip`
- macOS arm64 DMG 和 ZIP：`npm run package:mac:archives`
- macOS arm64 应用目录：`npm run package:mac:dir`
- Linux x64 AppImage：`npm run package:linux:appimage`
- Linux 测试目录：`npm run package:linux:dir`

构建环境、打包检查和平台测试步骤见 [构建与发布](docs/BUILD-RELEASE.md)。
