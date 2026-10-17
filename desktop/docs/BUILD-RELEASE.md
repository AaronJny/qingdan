# 青单桌面构建与发布

使用 Node.js 24.19.0、Python 3 与锁定的 Electron 44.6.0 / electron-builder 26.15.3。当前 backend 由同仓库 application 的完整检查快照生成，不再要求旧冻结 payload 或手工拷贝依赖。

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

准备命令先调用 server-packaging/prepare-runtime.py，校验全部源文件与编译资源哈希；保留 dist/server、dist/client（包括独立离线壳）、全部 drizzle 迁移。随后通过 esbuild 的编译产物分析取得外部服务依赖，提取 application/package-lock.json 中的精确依赖闭包，用 npm ci --omit=dev --ignore-scripts 安装。当前必需包为 @js-temporal/polyfill、ical.js、jsbi。需要安装脚本、平台限制或未审查下载源的新依赖会阻止准备，不能静默引入。生成的运行与依赖清单记录当前版本、源码快照、官方 npm integrity 和文件 SHA256；不包含用户数据。

backend/ 全部属于生成文件，不提交到 Git。源码构建者必须先准备后端；package.cjs 会拒绝缺失、陈旧、被修改或超出 1.x 兼容范围的输入。用户数据目录 QingdanDesktop、应用标识 app.qingdan.desktop 与现有登录/服务安全边界保持稳定。

平台打包在对应操作系统运行：

```sh
node scripts/package.cjs win --x64 --zip
node scripts/package.cjs mac --arm64 --dmg --zip
node scripts/package.cjs linux --x64 --appimage
node scripts/package.cjs linux --x64 --dir
```

脚本运行桌面语法/单元检查、校验内置后端，然后调用 electron-builder（--publish never）。完成后独立读取成品 app.asar，检查当前源码、后台运行资源、依赖文件与全部既有 Electron fuses；结果写在 dist/verified-平台-架构.json。macOS 保留官方 Electron Helper 名称和中文应用名、许可证复制及既有打包钩子。本流程未配置正式签名或公证身份，成品仍需 macOS 实机启动验收。

npm run verify:backend 使用普通 Node 在临时合成数据目录检查精确版本握手、前端、迁移、建任务、正常停止/重启持久性。该检查不代表 Electron utilityProcess 或原生 GUI 已通过。GitHub check.yml 在每次分支 push/PR 上运行完整检查及运行后端测试，不发布 Release。release.yml 复用这些已验证构建资源，分别在 macOS/Windows/Linux 打包并检查 ASAR；发布请求由 `.github/release/request.json` 指定；修改该文件、推送匹配版本的标签或手动运行“青单发布”工作流可触发构建。发布条件和平台成品要求见工作流配置。

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

## 历史变更说明

## 1.0.2 Mac 启动修复

1.0.1 的 CFBundleName=青单与实际 Qingdan Helper 路径不匹配。Electron 44.6.0 在 JavaScript 启动前先寻找 Electron Helper，找不到再寻找 CFBundleName 对应的辅助程序，原包两者都缺。1.0.2 在 afterPack（签名和 fuse 最终处理之前）把四类辅助程序恢复为官方 Electron Helper 名称、匹配 CFBundleExecutable，显示名称为中文；mac.executableName 固定为青单，使主可执行文件和外层目录都是青单。app.qingdan.desktop 和 QingdanDesktop 数据目录保持稳定，冻结的 c319 后端与 Android 源码不变。

新增 test/mac-bundle.test.cjs 覆盖原错误、四种 helper、中文显示名、缺失/权限/冲突拒绝及稳定配置。scripts/mac/inspect-launch.py 对真实解包 app 按固定版本规则检查辅助程序。该检查不是 macOS 原生运行测试。

## 1.0.3 文案清理

本次仅删去设置页与运行说明中多余的产品比较和声明，没有新增宣传文案。正常重建了在线/离线前端；Mac继续保持1.0.2修复后的helper、中文app和数据目录。用户数据库、后端API及依赖许可证未改。详见RELEASE-1.0.3.md。
