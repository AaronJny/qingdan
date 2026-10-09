# 青单 Mac 1.0.2 修复与验证

日期：2026-10-09。目标：macOS 13 及以上、Apple Silicon。

## 修复内容

原包主 Info.plist 的 CFBundleName 为“青单”，内部实际是 Qingdan Helper。Electron 44.6.0 启动时先寻找 Electron Helper，再按 CFBundleName 寻找辅助程序；两者都不存在，导致 JavaScript 启动前触发 Unable to find helper app。

本次以最小打包修复统一路径：外层青单.app和主可执行文件青单；四类内部辅助程序使用官方 Electron Helper、Electron Helper (GPU)、Electron Helper (Plugin)、Electron Helper (Renderer)，CFBundleExecutable完全匹配，显示名为中文。修改发生在最终 fuses 和签名之前。主 app ID app.qingdan.desktop、四 helper ID、QingdanDesktop数据目录均保持稳定。

官方实现：[Electron 44.6.0 helper 查找](https://github.com/electron/electron/blob/v44.6.0/shell/app/electron_main_delegate_mac.mm#L59-L69)、[CFBundleName读取](https://github.com/electron/electron/blob/v44.6.0/shell/common/application_info_mac.mm#L29-L31)。

## 最终 DMG 验证

文件：青单-1.0.2-mac-arm64.dmg

- 大小：123,560,269 bytes
- SHA256：2657de7d6fe05ec3da2ad2de1bfbc5691ce678ac5c8538f782b54fa40ceb53bf
- 真正的 UDIF/HFS+ 镜像，独立 Debian 7-Zip 的 Dmg/CRC 测试通过
- 独立抽取的 HFS 分区与构建原始分区逐字节相同；fsck -fn通过
- HFS catalog中卷名、应用目录和主程序实际为“青单”（UTF-16BE 97525355）
- 602个stage项、15个symlink的文件字节、权限、目标全部匹配；没有意外catalog项
- Applications 为 /Applications 的拖拽安装链接
- 旧1.0.1真实DMG用独立7-Zip解出后，固定44.6.0 helper规则失败；新最终DMG实际解出后同规则通过，四helpers均可执行且与各自plist一致
- 最终解包app有13个Mach-O，全部含ad-hoc封印；54,365个代码页校验无错，特殊slot无错或未核项；资源哈希、symlink与嵌套cdhash核验无错
- ASAR header SHA256为678950a21e402a14bd913675220847e4e146a7bdc976829a3e24111b1b21f579，与Info.plist一致
- ASAR整体SHA256为89e804e6e569ce513021311cf607c03c6db04ce16fee71e00f6b41d5dbe1b520；Mac/Linux本轮ASAR逐字节相同
- ASAR内14个桌面源码文件、32个后端运行文件、38个运行依赖文件与冻结源一致
- 七项安全fuses保持原设置，包括禁用RunAsNode、禁用NODE_OPTIONS/Node inspect参数、启用ASAR完整性与仅从ASAR加载；应用仍启用sandbox

签名使用从固定crates.io源码/锁文件以官方Rust 1.85.1构建的apple-codesign 0.29.0，显式空signer和无时间戳，无Developer ID身份或公证上传。

## 源码与回归

- npm run check（含全部82项桌面测试）通过；新增5项Mac打包回归
- 与输入完整源码ZIP逐字节比较：application 213文件、server-packaging 14文件、Android 287文件、desktop/src 14文件及desktop/backend 83文件全部未变
- 业务后端仍为c3194463a8cf748242955c61da72969c652ea062、1.0.1；仅桌面发行版本提升到1.0.2
- HFS补丁额外通过31项ASan/UBSan编码测试、17项/4链接的真实中文fixture和独立解包验证

## 升级和验证边界

升级前先正常退出旧版，移走“应用程序”内旧名Qingdan.app，然后把青单.app拖入Applications。保留用户Library/Application Support/QingdanDesktop目录；本次不会迁移或改名用户数据目录。

本轮未在macOS原生执行，未验证原生codesign、Gatekeeper、挂载、Finder拖拽或启动。以上Linux结构与哈希检查不能证明Apple接受签名，也不能代替真实Mac启动。当前只有ad-hoc完整性封印，没有Developer ID/Apple公证。

本轮Linux成品构建与静态检查通过，但执行容器禁止创建AF_UNIX socket，X显示服务无法启动，因此未重跑Linux GUI。旧1.0.1的Linux GUI记录仅作历史证据。没有通过关闭sandbox、fuse、Gatekeeper或移除隔离属性来使测试通过。
