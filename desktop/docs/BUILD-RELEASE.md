# 青单桌面构建与发布

本文面向桌面端开发和发行维护。安装与使用见 [桌面端说明](../README.md)。

需要 Node.js 24.19.0、Python 3、Electron 44.6.0 和 electron-builder 26.15.3。内置后端由同仓库 `application/` 源码生成。

```sh
cd application
npm ci
npm run check
cd ../desktop
npm ci
npm run prepare:backend
npm run verify:backend
npm run check
```

准备命令先调用 server-packaging/prepare-runtime.py，校验全部源文件与编译资源哈希；保留 dist/server、dist/client（包括独立离线壳）、全部 drizzle 迁移。随后通过 esbuild 的编译产物分析取得外部服务依赖，提取 application/package-lock.json 中的精确依赖闭包，用 npm ci --omit=dev --ignore-scripts 安装。当前依赖闭包记录在生成的 dependency-manifest.json 中，包括日期、日历和国际化运行依赖。需要安装脚本、平台限制或未审查下载源的新依赖会阻止准备，不能静默引入。生成的运行与依赖清单记录当前版本、源码快照、官方 npm integrity 和文件 SHA256；不包含用户数据。

backend/ 全部属于生成文件，不提交到 Git。源码构建者必须先准备后端；package.cjs 会拒绝缺失、陈旧、被修改或超出 1.x 兼容范围的输入。用户数据目录 QingdanDesktop、应用标识 app.qingdan.desktop 与现有登录/服务安全边界保持稳定。

平台打包在对应操作系统与 CPU 架构运行：

```sh
node scripts/package.cjs win --x64 --zip
node scripts/package.cjs mac --arm64 --dmg --zip
node scripts/package.cjs mac --x64 --dmg --zip
node scripts/package.cjs linux --x64 --appimage
node scripts/package.cjs linux --x64 --dir
```

脚本运行桌面语法/单元检查、校验内置后端，然后调用 electron-builder（--publish never）。完成后独立读取成品 app.asar，检查当前源码、后台运行资源、依赖文件与全部既有 Electron fuses；结果写在 dist/verified-平台-架构.json。macOS 保留官方 Electron Helper 名称和中文应用名、许可证复制及既有打包钩子。本流程未配置正式签名或公证身份，成品仍需 macOS 实机启动验收。

npm run verify:backend 使用普通 Node 在临时合成数据目录检查精确版本握手、前端、迁移、建任务、正常停止/重启持久性。该检查不代表 Electron utilityProcess 或原生 GUI 已通过。GitHub check.yml 在每次分支 push/PR 上运行完整检查及运行后端测试，不发布 Release。release.yml 复用这些已验证构建资源，分别在 macOS/Windows/Linux 打包并检查 ASAR；发布请求由 `.github/release/request.json` 指定；修改该文件、推送匹配版本的标签或手动运行“青单发布”工作流可触发构建。发布条件和平台成品要求见工作流配置。

## macOS 双架构

Apple Silicon 使用 GitHub 标准托管 `macos-15` runner，Intel 使用 `macos-15-intel` runner，各自原生构建 DMG 与 ZIP。构建前核验 Node/操作系统架构，阻止把另一架构的成品改名发布。两者分别保留归档与后端验收报告、校验文件，发布和清理闸门要求两种架构齐备。

归档验收在对应架构的 macOS runner 上全新解压 ZIP、只读挂载 DMG，比较全部文件、权限与符号链接，并检查主程序、Electron frameworks/helpers 及内置原生模块的 Mach-O 架构。内置服务的 JavaScript 依赖随包提供，SQLite 使用相同架构的 Electron Node 运行时。该检查覆盖包结构、架构、完整性及普通 Node 后端烟雾测试；不等同于 Intel 或 Apple Silicon 实机 GUI 验收。

发布工作流还在两种架构上分别执行两个原生运行门禁，任何一个失败都会阻止发布：

- `smoke-local-session.cjs` 在 `npm ci` 后复制官方 Electron 44.6.0 到临时测试目录，仅在副本中启用 CookieEncryption，并重置副本的 ad-hoc 签名；核验其他 fuse 及源运行时的 fuse 未变。两个真实 Electron 进程使用合成数据，验证生产 preload、IPC、内存会话、同步保存与重启恢复，以及弹窗隔离和后端失效后的受信 Blob 导出。
- `smoke-packaged-recovery.cjs` 在成品及归档校验后，用同架构官方 Electron 的 Node 模式加载成品 ASAR 中的 `classic-level` 和最终解包的原生绑定，完成合成数据库写入、读取与重新打开。它不启动产品应用，也不改动产品的 RunAsNode 等 fuse。运行过的绑定哈希必须与最终包、ZIP 解出内容及只读挂载 DMG 中的实际绑定字节一致；原生签名后可能变化的字节以最终磁盘文件为准，不使用 ASAR 的签名前哈希替代。

结果写入 `verified-mac-架构.json` 的 `localSessionSmoke` 和 `packagedRecoverySmoke`，绑定哈希同时写入包和归档报告。自动测试使用临时数据；产品 GUI 与钥匙串权限提示仍需单独进行设备测试。

GitHub runner 标签来源：[GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

## Linux x64 AppImage

Linux 与 macOS 共用 src/main.cjs、隔离窗口、连接设置和内置后端管理，不另维护应用源码。Linux 像 Windows 一样在最后一个窗口关闭后退出；当前桌面代码没有托盘常驻依赖。

AppImage 使用锁定 electron-builder 26.15.3 中的 appimage 1.0.3 静态运行时工具集。下载地址与 SHA256 固定在该版本的 app-builder-lib/out/toolsets/linux.js，构建器自动验证工具下载。AppImage 文件不再套一层 ZIP。

该构建器默认生成的 AppRun 在 user namespace 不可用时会自动添加 --no-sandbox。本项目的 finalize-linux-bundle.cjs 提供安全启动器，构建器在生成 AppRun 后复制当前打包目录，使该启动器成为最终文件；appImage.executableArgs 同时明确设为空数组。启动器没有关闭沙箱的自动降级路径，显式拒绝关闭沙箱的选项。不提供修改 AppArmor、系统 namespace 限制或 setuid 权限的绕过步骤。若系统无法正常初始化 Electron 沙箱，应停止运行并使用符合安全要求的系统环境。

package.cjs 生成 Qingdan-版本-linux-x64.AppImage 后自动调用 verify-linux-appimage.cjs --smoke：

- 在全新的临时目录执行 --appimage-extract，不依赖 FUSE 挂载
- 检查 AppImage/应用 ELF 为 x86-64，逐字节匹配 linux-unpacked 中的全部应用文件及固定工具集中的运行库
- 验证安全 AppRun、desktop Exec、中文名称、图标与内部相对链接；拒绝额外文件、越界或悬空链接、用户数据与仓库状态
- 从干净解出的 app.asar 再次检查当前源码、后端文件/依赖与七项安全 fuses
- 解出已核验的实际 ASAR 后端，用构建机普通 Node 24 在合成数据目录测试版本握手、在线及离线资源、迁移、日历 worker、建任务与正常重启持久性

结果写入 dist/verified-linux-appimage-x64.json，明确记录 electronUtilityProcessTested=false、nativeGuiTested=false。此流程验证 AppImage 结构及归档后端，不代表 Linux 窗口、Electron utilityProcess、图形菜单、桌面通知、X11/Wayland 或发行版兼容性已实机验收。
