# 青单桌面 1.0.3

默认打开即自动启动内置本机服务，不需要安装Node、运行npm或另开服务。内置服务使用Electron44.6.0自带的Node24.21.0与SQLite；服务只绑定127.0.0.1，启动端口由本客户端选择，遇占用会另选端口，不接管其他服务。内置应用以c3194463a8cf748242955c61da72969c652ea062为基线，本次仅清理设置页文案并重建前端，后端程序、数据库迁移和运行依赖不变。

## 使用

- macOS13及以上、Apple Silicon：打开最终DMG，先正常退出并移走“应用程序”内旧名Qingdan.app（保留QingdanDesktop数据目录），再把青单.app拖到Applications运行。当前仅有自生成ad-hoc完整性签名，没有Developer ID/Apple公证，系统可能阻止打开；本工程不提供关闭系统安全或移除隔离的步骤。macOS原生挂载、拖拽、启动尚待验证。
- Windows x64：把最终ZIP完整解压到一个目录，运行Qingdan.exe。不要只取出EXE。没有发布者证书，Windows原生运行尚待验证。
- 本机模式无需账号密码。设置中的“连接私服”可填准确HTTPS服务地址；由该服务器决定自己的账号模式。本客户端不创建账号、保存密码或修改服务器配置。字面127.0.0.1、[::1]、localhost的HTTP服务也可手动配置。
- 正常退出时停止本客户端拥有的服务。下次启动恢复同一数据；升级替换应用程序不会主动删除用户数据。

## 数据与设置

稳定用户目录为系统appData下的QingdanDesktop：macOS通常为~/Library/Application Support/QingdanDesktop，Windows通常为%APPDATA%\\QingdanDesktop。local-data保存本机数据库与附件，local-backend.json只记录首选端口；服务器连接设置不含口令。浏览器profile保存正常会话cookie与界面草稿。同一服务器账户的数据由私服保存，和本机模式隔离。

备份前先正常退出应用，再复制完整QingdanDesktop目录。目录包含个人任务和会话数据，请自行妥善保存。

## 从源码构建

需要Node24及npm。在本目录执行npm ci、npm run check、npm test。backend内保留冻结运行资源和两个最小外部依赖的源码/许可证/哈希；无需再装后端依赖。

- WindowsZIP：npm run package:win:zip
- macOS arm64 .app目录：npm run package:mac:dir；在macOS可使用系统工具生成DMG并检查实际签名/运行。无证书的构建不会获得Developer ID或公证。
- Linux内部QA目录：npm run package:linux:dir；这不是用户要求的Windows/macOS成品。
- Linux生成真正DMG的固定Mozilla源码/可信Debian构建链和UTF-8/UTF-16中文文件名修复见docs/DMG-TOOLCHAIN.md。scripts/build-dmg-linux.py只处理独立完成的青单.app，不挂载系统镜像。

scripts/verify-packaged.cjs非执行式核验ASAR、冻结后端/依赖文件和七项安全fuses。GUI验证证据另附发行核验报告，纯测试不能代替两平台原生运行验收。
