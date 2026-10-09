# 青单：独立运行

这是自托管的任务、日历、专注与习惯应用。最终运行在你的本机或私人服务器，不依赖 ChatGPT 登录、Sites、Cloudflare 或第三方账号。旧的托管工程与数据没有自动搬入这里。

## 本地单人模式

安装 Node.js 24，然后在本项目目录运行：

```sh
npm ci
npm run build
npm start
```

打开 http://127.0.0.1:4310。默认 `APP_MODE=local`，直接进入自己的工作台，无账号密码，也不需要初始化管理员。数据在 `data/local`；仅本机回环监听。不能把此模式配置为 `0.0.0.0` 或非回环来源，也不能反向代理或隧道公开。服务拒绝携带Forwarded/X-Forwarded-*的本地模式请求；这不能阻止操作者主动剥掉头并转发，免登录模式不具有面向网络的账号隔离保证。需要网络访问请使用accounts模式。

`PORT` 可改端口；`HOST` 默认 `127.0.0.1`。使用 localhost、IPv6 或其他端口时，`APP_ORIGIN` 必须是浏览器实际访问的完整来源。例如：

```sh
HOST=localhost PORT=4311 APP_ORIGIN=http://localhost:4311 npm start
```

## 账号模式

适合私人服务器、多设备或多人使用。先在部署机器自己的交互终端初始化管理员；密码会隐藏输入，不接受参数/环境变量或管道，不存在默认密码：

```sh
APP_MODE=accounts npm run users -- init-admin
APP_MODE=accounts npm start
```

本机仍打开 http://127.0.0.1:4310，输入你创建的邮箱和密码。管理员可在设置→账号管理创建账号、停用/启用、改角色或重设密码；最后一个启用管理员受保护。没有公开注册。管理员身份不赋予查看其他账号私人任务的权限。

Windows PowerShell中设置本次终端环境再执行（不要把密码写入环境）：

```powershell
$env:APP_MODE = "accounts"
npm run users -- init-admin
npm start
```

私服HTTPS来源由实际TLS代理提供时：

```powershell
$env:APP_MODE = "accounts"
$env:HOST = "127.0.0.1"
$env:PORT = "4310"
$env:APP_ORIGIN = "https://tasks.example.com"
$env:QINGDAN_DATA_DIR = "C:\qingdan-data"
npm start
```

切回免登录模式设置 `$env:APP_MODE = "local"`，并清除/重设APP_ORIGIN为准确本机来源及DATA_DIR为独立local目录，不复用accounts目录。

数据默认在 `data/accounts`。所有业务共用相同的真实 SQLite 与文件存储；两个模式的数据目录有持久模式标记，本地身份与目录绑定。错误模式打开已有目录会拒绝，不能通过改环境变量让多账号数据免登录展示。迁移请明确导出并导入新目录，不暗改数据所有权。

私服对外访问必须 HTTPS，配置实际来源、由你的反向代理提供 TLS：

```sh
APP_MODE=accounts HOST=127.0.0.1 PORT=4310 APP_ORIGIN=https://tasks.example.com QINGDAN_DATA_DIR=/srv/qingdan-data npm start
```

APP_ORIGIN只定义浏览器来源，不会给Node的HTTP监听添加TLS。示例后端绑定127.0.0.1，实际HTTPS由反向代理终止；不要把4310裸HTTP端口暴露到外网。服务只接受配置的 Host/Origin；反向代理须保留该 Host。会话 Cookie 为 HttpOnly、SameSite=Strict，HTTPS启用Secure；业务写入验证同源和CSRF。没有跨域API配置，不信任任意代理身份头。HTTP仅允许回环浏览器来源。

同机Caddy的最小配置示例（把示例域名换成自己的实际域名，先设置同一APP_ORIGIN）：

```text
tasks.example.com {
    reverse_proxy 127.0.0.1:4310 {
        header_up Host tasks.example.com
    }
}
```

Caddy负责证书与TLS，部署者须自行确认域名/证书和网络；本项目不会配置你的域名。Node不采纳任意X-Forwarded-*身份或来源。

## Docker Compose

示例默认是账号模式；宿主端口只绑定127.0.0.1，适合本机测试或同机HTTPS代理：

```sh
docker compose up -d --build
docker compose exec qingdan node dist/server/users.mjs init-admin
```

第一次命令会建立持久命名卷；第二次必须在交互终端输入管理员信息。私服启动前设置 `APP_ORIGIN=https://你的实际域名`，再由同机代理转发到127.0.0.1:4310。示例不替你申请证书、改防火墙、设置公网或创建真实账号。Docker构建/运行验证状态见 `VERIFICATION.md`。

## 数据与备份

`QINGDAN_DATA_DIR` 指定实例数据目录。内容为SQLite（运行时可能有-wal/-shm）和 `objects/*.qobj` 附件。不要在运行时只复制sqlite主文件；停止服务后完整备份整个目录，再恢复到新路径。目录模式标记和本地identity必须一起保留。

应用内JSON可恢复为新副本。v1不含文件字节；v2按已有预算包含附件与历史。账号、密码与会话不进入任务备份。恢复账号库/密码会话的实例目录备份应由部署者安全保管，不公开分享。

SQLite 与文件对象分别持久化；文件写入采用临时文件、fsync 和原子替换，业务数据库写入使用事务。数据库迁移按 checksum 记录，已应用迁移不修改。

## 运行与检查

```sh
npm run check
```

这依次运行模块、模拟DOM、真实本机HTTP集成、TypeScript、前端/Node/独立离线壳构建；任何一步失败立即停止。`npm run dev` 运行源码Node服务，先运行build生成前端（它不是Vite热更新入口）。

本地和账号模式均为持久服务。桌面封装连接本地服务或你选定的 HTTPS 私服，服务需另行启动。

桌面客户端可读取同源GET `/api/app-info`，只返回 `{app:'qingdan',version:'1.1.0',mode:'local'|'accounts'}`；不会建立账号会话，也不包含数据、凭据或运行诊断。

## 附件上传结果未知时

任务附件在发送前记录账号/任务专属操作ID、文件元数据与SHA-256指纹；不保存文件字节。连接中断或关闭详情后，重开可选择“核对原附件上传”。服务已有完成回执时直接恢复文件列表；尚未完成时请主动重选同一份文件，继续原操作。文件内容、名称或类型改变会提示冲突；先核对或明确放弃原选择后才开始新上传。放弃选择不会删除已上传文件。已删除附件的旧上传操作不会重新创建它。

操作预约持久保存到SQLite，成功的附件元数据与完成回执在同一事务提交。文件系统写入与数据库不是统一事务；失败可能留下暂未引用的对象，保留操作ID重试会复用该对象。不会自动上传其他文件或离线保存文件字节。账号切换不显示另一个账号的未确认选择。
