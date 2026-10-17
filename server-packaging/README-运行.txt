青单 {{VERSION}} 服务端 / 网页端

本包包含 Node.js 运行时、网页和服务，解压即可运行，无需安装 Node.js 或 npm。
支持 Apple Silicon Mac（macOS 13.5 及以上）和 Linux x64（glibc 2.28、内核 4.18 及以上）。暂不支持 Intel Mac、Linux ARM 或 Alpine/musl。

本机使用
Mac 双击 start.command，Linux 运行 start.sh，然后在浏览器打开 http://127.0.0.1:4310。
本机模式无需账号密码，只能在本机访问。不要通过反向代理或隧道公开此模式。
保持启动窗口运行，停止服务使用 stop.command 或 stop.sh。

账号模式
切换前先停止正在运行的服务。首次运行 init-admin.command（Linux 为 init-admin.sh），按提示设置管理员邮箱、姓名和密码。密码输入时隐藏，没有默认密码或公开注册。
再运行 start-accounts.command（Linux 为 start-accounts.sh）。管理员登录后，可在“设置 → 账号管理”中管理账号。
本机与账号模式使用独立数据目录，切换不会自动迁移任务。需要迁移时，通过应用导出并导入。

配置
Mac：~/Library/Application Support/Qingdan Server/config.json
Linux：${XDG_DATA_HOME:-~/.local/share}/qingdan-server/config.json

首次启动会自动创建配置：
- mode：local 为本机模式，accounts 为账号模式。
- host：默认 127.0.0.1。
- port：默认 4310。
- origin：浏览器访问来源；留空时使用 http://127.0.0.1:端口。
- dataDir：数据目录；留空时按模式使用配置根目录下的 data/local 或 data/accounts。

高级部署可通过 QINGDAN_SERVER_HOME 指定配置根目录，通过 QINGDAN_DATA_DIR 指定数据目录。修改配置前先停止服务，不要让多个进程使用同一数据目录。

多设备与私服访问
使用 accounts 模式，将 origin 设为实际 HTTPS 域名，再由 TLS 反向代理转发到本机 HTTP 端口，并保留配置的 Host。网页与 API 必须同源。
origin 写成 https 不会为后端启用加密，不要直接公开后端 HTTP 端口。

备份与升级
先停止服务，再完整复制数据目录，包括 SQLite 数据库、附件对象和模式标记。不要在运行中只复制数据库主文件。备份可能包含账号和会话信息，请妥善保管。
应用内任务备份不含账号密码或会话。
升级时，将新包解压到独立目录，再启动服务。默认数据位于用户目录，移动或替换程序文件夹不影响数据；请保留并备份数据目录。

附件上传中断
重新打开原任务详情，选择“核对原附件上传”。已成功上传的附件会恢复显示；尚未完成时，重新选择同一文件继续。放弃未确认选择不会删除已上传文件。

更多说明
本发行包请使用根目录启动脚本，无需在 app 目录安装依赖或重新构建。
文件校验清单见 SERVER-MANIFEST.json，Node.js 来源与许可证见 runtime 目录，依赖许可证随 app/node_modules 保留。
遇到系统或浏览器安全警告时，请先核实来源，保留系统安全设置。
