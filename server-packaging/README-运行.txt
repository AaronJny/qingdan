青单 1.0.1 独立服务端 / 网页端
精确应用源码：c3194463a8cf748242955c61da72969c652ea062

本包已包含 Node 24.19.0、网页、服务与生产依赖。无需安装 Node、npm，也无需构建。
支持 Apple Silicon Mac（macOS 13.5 以上）和 Linux x64（glibc 2.28、内核4.18以上）。不包含 Intel Mac、Linux ARM 或 Alpine/musl 运行时。Mac 实机启动尚未验证。

本机免密码：
Mac 双击 start.command；Linux 运行 start.sh。浏览器会打开 http://127.0.0.1:4310。
这是本机单人模式，不能反代或通过隧道公开。保持启动窗口运行；正常停止用 stop.command / stop.sh。
默认数据放在用户目录，更新或移动程序文件夹不会删掉数据。

自有账号模式：
首次先双击 init-admin.command（Linux init-admin.sh），按提示设置首个管理员。口令在交互终端不回显；没有默认密码或公开自助注册。
再双击 start-accounts.command（Linux start-accounts.sh）。管理员登录后可在账号管理中新增/停用用户、改变角色或重设密码。
两个模式使用不同数据目录，不能通过改模式直接把多账号数据变成免密码数据。账户初始化不会自动转移本地任务。

配置位置：
Mac：~/Library/Application Support/Qingdan Server/config.json
Linux：${XDG_DATA_HOME:-~/.local/share}/qingdan-server/config.json
首次启动自动建立配置。mode为local或accounts；默认host=127.0.0.1、port=4310；origin为空时使用http://127.0.0.1:端口；dataDir为空时按模式建立用户目录下data/local或data/accounts。
高级部署可用QINGDAN_SERVER_HOME选择另一配置根目录；QINGDAN_DATA_DIR可指定完整数据目录。不要让两个进程同时占用同一目录。修改配置前先停止服务。
启动时若端口已占用或模式目录不符，会明确失败，不连接其他服务、不自动认领其他数据。

Linux私服 / 多设备网页访问：
仅accounts模式可用于私服。设置实际HTTPS origin，由你自己的TLS反向代理转发到本机HTTP端口，保留配置的Host；后端默认绑定127.0.0.1。origin写成https本身不会给Node监听加密。不要把裸HTTP端口直接公开。
需要同源网页与API；不使用GPT登录或GPT平台。
本包不配置真实域名、证书、第三方账号或外部AI凭据。

备份：
先stop并确认服务停止，再完整复制用户数据目录（含SQLite、对象文件、模式标记）。不要在服务运行时只复制sqlite主文件。恢复时保持目录模式一致。账号库/会话的目录备份由部署者自行妥善保管。
应用内任务JSON备份不含账号口令或会话；不同模式数据迁移应由用户明确导出/导入。

附件上传未知结果：
原任务详情保留操作ID与文件指纹，关闭详情重开后点“核对原附件上传”。已完成的回执恢复同一文件，不追加上传；尚未确认时主动重选同一文件继续。不同文件会提示冲突。放弃未确认选择不会删除已上传文件。浏览器不保存附件字节。

验证边界：
应用同快照395模块/106模拟DOM/3真实服务测试及类型、构建通过。1440/390真实Chromium桥15步附件专项通过；桥使用真实SQLite/本地文件处理器，未知故障只在传输层模拟，about:blank SHA只委托Node真WebCrypto，不冒充原生浏览器环境。另有Linux原生薄壳真HTTP普通上传通过（无SHA/UUID shim，40B文件实盘SHA一致）；未知响应仍只桥验证。
本发行包Linux内置运行时正常启动、建任务/附件、正常停止/重开持久性、模式隔离、重复启动拒绝与交互首管理员隐藏口令已过；最终ZIP解压复测会外附结果。
Mac实机、Docker镜像、真实私服HTTPS/账号原生Cookie、关闭页面可靠提醒、外部AI/OAuth等尚未全部验收或配置。

更新：
停止旧包服务，解压新包到独立目录，再启动。数据默认在用户目录；保留并备份它，不要混用local/accounts数据。后台迁移校验已应用SQL，拒绝变化过的迁移。
app目录里的README/运行包说明是应用源基线的开发资料；本发行包使用根目录启动入口，不要照内部资料安装npm或重新build。
如macOS或浏览器出现安全来源提示，请按系统正常流程核实，不绕过安全警告或删除隔离属性。
Node官方来源/校验与许可证见runtime目录；依赖许可证随app/node_modules保留。
