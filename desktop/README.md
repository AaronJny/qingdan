# 青单桌面端

支持 macOS、Windows 和 Linux。打开应用即自动启动内置服务，无需安装 Node.js 或运行终端命令；任务与附件保存在本机，也可以连接自己的青单私服。

## 安装与使用

- **macOS**：支持 Apple Silicon（arm64）和 Intel（x64），macOS 13 及以上。下载时按处理器选择对应 DMG。打开 DMG，将“青单.app”拖入 Applications 后打开。升级前先正常退出旧版；如果仍有旧名 `Qingdan.app`，请移走旧应用，保留 `QingdanDesktop` 数据目录。
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
- macOS Intel x64 DMG 和 ZIP：`npm run package:mac:x64:archives`
- macOS Intel x64 应用目录：`npm run package:mac:x64:dir`
- macOS arm64 应用目录：`npm run package:mac:dir`
- Linux x64 AppImage：`npm run package:linux:appimage`
- Linux 测试目录：`npm run package:linux:dir`

构建环境、打包检查和平台测试步骤见 [构建与发布](docs/BUILD-RELEASE.md)。

macOS 发布 CI 在 arm64 与 x64 上分别运行两项额外检查：用临时官方 Electron 副本验证本机内存会话、输入持久化与访问隔离；用官方 Electron Node 模式加载最终包内的原生恢复绑定，核对其字节与 ZIP、DMG 一致。测试不会弱化产品安全 fuse；证据并入已有报告，完整 Release 仍为 32 个资源（含清单）。它们只使用合成数据，没有直接监测钥匙串调用，也不代表最终产品 GUI 或实机钥匙串行为已验收。

## 1.2.1 本机存储与旧输入核对

本机工作台使用专用内存浏览会话；草稿、未确认操作身份与界面偏好通过受限原生存储保存在 `local-ui/`，写入确认后才视为持久保存。这个路径不需要 Electron 的磁盘 Cookie 加密或 macOS 钥匙串。私服登录仍使用独立、加密的持久会话，macOS 可能为私服会话请求钥匙串访问。应用没有关闭 Cookie 加密，也不会读取或清理已有钥匙串项目。

升级保留 `local-data/` 中的数据库与附件，以及旧版浏览器目录。若检测到旧本机浏览器存储，应用仅离线复制其中的 Local Storage 数据，保存校验过的独立副本，并在“帮助 → 核对以前的本地输入”提供候选查看与 JSON 导出。旧草稿和未确认操作不会自动导入或重放；读取成功也不能证明旧日志完整。需要与已保存任务核对后再手动处理。可选择继续使用已保存任务，核对提醒会保留，之后还能返回。

已有保存任务不会因这一步被迁移或清空。若原生存储本身损坏或不可写，应用会停止进入可编辑工作台；请保留数据目录和错误信息，不要删除存储以绕过提示。编辑过程中若输入保存失败，先使用“导出未保存输入”，确认文件已保存，再重新打开应用核对。普通任务备份不包含这些未保存输入，导出内容也不能作为待执行操作直接导入。

本机草稿与原有任务数据库一样属于当前操作系统用户的本地数据；请使用自己的设备账号，并妥善保管整个用户目录及导出文件。网页端和 Android 的浏览器存储行为不因这项桌面改动而改变。
