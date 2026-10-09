# 青单 1.0.3 文案修订

本次桌面修订只删除设置页和运行说明里多余的外部产品比较与声明，没有新增宣传横幅或改变功能。正常重建在线、离线及Android内置网页资源，不对压缩后的JS做手工替换。

## 兼容性

- 保留Mac1.0.2的中文青单.app、四类Electron Helper路径、辅助程序元数据和最终签名流程。
- 主appID、Windows执行入口、QingdanDesktop用户数据目录、Android应用ID与数据身份不变。
- 应用协议/数据库仍为1.0.1，服务器main.mjs、users.mjs和数据库迁移与之前逐字节相同。
- 第三方依赖、许可证、fuses与sandbox设置不变。

## 核验

- 应用纯测试395、React UI106、实际本地HTTP/附件服务测试3全部通过；类型检查和生产构建通过。
- 桌面82项测试通过。Mac/Windows ASAR逐字节相同，SHA256为5261807900c927494f5bf2f3b083cb291fc582b02bbb07eb84f1ac2f43a18114。
- Mac最终DMG经独立7-Zip解包检查，中文HFS目录、Applications安装链接、文件字节和权限与stage一致；最终app helper查找规则通过。
- 13个Mac Mach-O、54,365个代码页、特殊slot及资源封印校验无错；ASAR、前端资源和七项fuses验证通过。
- Windows ZIP的全部文件CRC与解压目录字节匹配，PE为amd64。没有本项目发布者签名。
- 源码、说明、已生成前端、Mac和Windows成品都做了目标文案扫描，结果为0命中。具体技术格式支持说明与真正许可证保留。

## 限制

Mac是ad-hoc完整性封印，没有Developer ID或Apple公证；没有本轮macOS原生codesign、挂载、Finder拖拽、启动或Windows原生运行证据，不把Linux结构检查称为原生验收。

Android仅更新源码和预生成网页资源，没有生成或签名新APK。原签名私钥当前不可用，不能承诺覆盖升级。Android验证中React UI首轮105/106，原失败项定向和全量复跑通过，未改源码掩盖；完整记录和实际Android SDK/设备验证边界见android/VERIFICATION.md。

本次没有读取、迁移或修改用户数据库。已有旧版安装不会自动更新，需使用对应的新交付包。

整合源码另外同步独立服务端的一处启动脚本修复：无参数运行start.sh时补上默认start操作，实例标记和owned-PID检查保持原逻辑。此脚本不在桌面ASAR内，Mac/Windows成品不受影响。服务端验证细节见server-packaging/BUILD.md。
