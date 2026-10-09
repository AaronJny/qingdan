# 青单桌面 1.1.0

默认打开即自动启动内置本机服务，不需要安装Node、运行npm或另开服务。内置服务使用Electron44.6.0自带的Node24.21.0与SQLite；服务只绑定127.0.0.1，启动端口由本客户端选择，遇占用会另选端口，不接管其他服务。内置应用从本仓库当前 application 源码完整检查通过的快照生成，版本与桌面包一致；编译文件、数据库迁移、离线页面与必要运行依赖一起打包。

## 使用

- macOS13及以上、Apple Silicon：打开最终DMG，先正常退出并移走“应用程序”内旧名Qingdan.app（保留QingdanDesktop数据目录），再把青单.app拖到Applications运行。当前构建没有Developer ID/Apple公证，系统可能阻止打开；本工程不提供关闭系统安全或移除隔离的步骤。macOS原生挂载、拖拽、启动尚待验证。
- Windows x64：把最终ZIP完整解压到一个目录，运行Qingdan.exe。不要只取出EXE。没有发布者证书，Windows原生运行尚待验证。
- 本机模式无需账号密码。设置中的“连接私服”可填准确HTTPS服务地址；由该服务器决定自己的账号模式。本客户端不创建账号、保存密码或修改服务器配置。字面127.0.0.1、[::1]、localhost的HTTP服务也可手动配置。
- 正常退出时停止本客户端拥有的服务。下次启动恢复同一数据；升级替换应用程序不会主动删除用户数据。

## 数据与设置

稳定用户目录为系统appData下的QingdanDesktop：macOS通常为~/Library/Application Support/QingdanDesktop，Windows通常为%APPDATA%\\QingdanDesktop。local-data保存本机数据库与附件，local-backend.json只记录首选端口；服务器连接设置不含口令。浏览器profile保存正常会话cookie与界面草稿。同一服务器账户的数据由私服保存，和本机模式隔离。

备份前先正常退出应用，再复制完整QingdanDesktop目录。目录包含个人任务和会话数据，请自行妥善保存。

## 从源码构建

在 application 中先运行 `npm ci`、`npm run check`；然后在 desktop 中运行 `npm ci`、`npm run prepare:backend`、`npm run verify:backend`、`npm run check`。backend 是生成目录，不是独立维护的冻结源码。准备命令校验同快照的源码与全部 dist 文件哈希证据，并安装编译产物必需的锁定运行依赖。

- Windows ZIP：`npm run package:win:zip`
- macOS arm64 DMG 和 ZIP：`npm run package:mac:archives`
- macOS arm64 .app 目录：`npm run package:mac:dir`
- Linux 内部 QA 目录：`npm run package:linux:dir`

macOS/Windows 成品分别在对应系统打包。scripts/verify-packaged.cjs 在打包后非执行式核验 ASAR、当前后端/依赖文件和七项安全 fuses。后端普通 Node 烟雾测试与纯单元测试不能代替 Electron utilityProcess 或两平台原生 GUI 验收。具体流程见 docs/BUILD-RELEASE.md；已有平台报告属于历史结果。
