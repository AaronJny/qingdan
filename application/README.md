# 青单服务端与网页端

青单将任务、日历、习惯和专注计时放在同一个工作台。可在本机免登录使用，也可部署到自己的服务器，供多台设备或多人使用。

## 本机使用

需要 Node.js 24。在 `application/` 目录运行：

```sh
npm ci
npm run build
npm start
```

打开 http://127.0.0.1:4310 即可使用，无需账号密码。默认模式为 `APP_MODE=local`，数据保存在 `data/local`。

本机模式只允许回环地址访问。不要通过反向代理、隧道或公网端口公开免登录服务；需要网络访问时，请使用账号模式。

`PORT` 可修改端口，`HOST` 默认是 `127.0.0.1`。修改访问地址或端口时，将 `APP_ORIGIN` 设为浏览器实际访问的完整来源，例如：

```sh
HOST=localhost PORT=4311 APP_ORIGIN=http://localhost:4311 npm start
```

## 账号模式

适合自有服务器、多设备同步或多人使用。在部署机器的交互终端初始化管理员，然后启动服务：

```sh
APP_MODE=accounts npm run users -- init-admin
APP_MODE=accounts npm start
```

按提示设置邮箱、姓名和密码。密码会隐藏输入，不接受命令参数、环境变量或管道传入。没有默认密码或公开注册。

打开 http://127.0.0.1:4310，使用刚创建的账号登录。管理员可在“设置 → 账号管理”中创建账号、启用或停用账号、调整角色和重设密码。不能停用或降级最后一位启用的管理员；管理员也不能因此查看其他账号的私人任务。

Windows PowerShell 需要先设置当前终端的环境变量：

```powershell
$env:APP_MODE = "accounts"
npm run users -- init-admin
npm start
```

账号模式的数据默认保存在 `data/accounts`。本机与账号模式使用独立数据目录，不能共用。需要切换使用方式时，通过应用导出数据，再导入新实例。

### 配置 HTTPS 私服

对外访问必须使用有效证书的 HTTPS。将 `APP_ORIGIN` 设为实际域名，由反向代理提供 TLS，后端继续监听本机地址。初始化管理员时也要使用相同的 `APP_MODE` 和 `QINGDAN_DATA_DIR`；已在默认目录创建的账号不会自动迁移到新目录：

```sh
APP_MODE=accounts QINGDAN_DATA_DIR=/srv/qingdan-data npm run users -- init-admin
APP_MODE=accounts HOST=127.0.0.1 PORT=4310 APP_ORIGIN=https://tasks.example.com QINGDAN_DATA_DIR=/srv/qingdan-data npm start
```

`APP_ORIGIN` 只指定访问来源，不会为 Node.js 服务启用 TLS。不要把 4310 的 HTTP 端口直接暴露到外网。反向代理应保留配置的 Host，网页与 API 必须同源。

同机 Caddy 配置示例，将域名替换为自己的域名，并设置相同的 `APP_ORIGIN`：

```text
tasks.example.com {
    reverse_proxy 127.0.0.1:4310 {
        header_up Host tasks.example.com
    }
}
```

使用前请完成域名解析并确认 Caddy 证书正常。更多认证配置和会话规则见 [账号说明](AUTH.md)。

Windows PowerShell 的私服配置示例：

```powershell
$env:APP_MODE = "accounts"
$env:HOST = "127.0.0.1"
$env:PORT = "4310"
$env:APP_ORIGIN = "https://tasks.example.com"
$env:QINGDAN_DATA_DIR = "C:\qingdan-data"
npm start
```

切回本机模式时，将 `APP_MODE` 改为 `local`，同时将 `APP_ORIGIN` 改为本机访问地址，`QINGDAN_DATA_DIR` 改为独立的本机数据目录。

## Docker Compose

仓库提供的 Compose 配置默认使用账号模式，宿主端口只绑定 `127.0.0.1`：

```sh
docker compose up -d --build
docker compose exec qingdan node dist/server/users.mjs init-admin
```

第一个命令创建持久化数据卷；第二个命令在终端中初始化管理员。对外部署前，将 `APP_ORIGIN` 设为实际 HTTPS 域名，再由同机反向代理转发到 `127.0.0.1:4310`。

## 数据与备份

`QINGDAN_DATA_DIR` 可指定实例数据目录，包含 SQLite 数据库、附件对象和模式标记。

- 备份实例前先停止服务，再完整复制整个数据目录。运行中可能存在 SQLite 的 `-wal`、`-shm` 文件，不要只复制数据库主文件。
- 恢复时使用独立目录，保留目录内的模式标记和身份信息。不要让多个进程同时使用同一目录。
- 应用内完整备份可恢复为新副本，包含附件与历史；旧版 v1 备份不含附件内容。单包最多 1000 条记录、10000 条历史、100 个附件，附件合计 8 MiB、元数据 5 MiB。超限时请保留原实例，先另行保存所需记录和附件。
- 任务备份不包含账号、密码和会话；完整实例目录可能包含这些私密信息，请妥善保管。

## 附件上传中断

连接中断后，重新打开原任务详情，选择“核对原附件上传”。已上传成功的附件会恢复显示；尚未完成时，重新选择同一文件继续上传。若文件内容、名称或类型已改变，请先核对原上传，或放弃原选择后重新上传。

放弃未确认的选择不会删除已上传文件。浏览器只保存待核对的文件信息，不保存附件内容，因此重试时需要重新选择文件。

## 开发与检查

```sh
npm run check
```

运行模块测试、界面测试、HTTP 集成测试、类型检查和构建。`npm run dev` 启动源码服务；前端需先运行 `npm run build` 生成，该命令不提供 Vite 热更新。

桌面端会自动启动自己的内置服务，也可以连接这里部署的私服。版本和运行模式可通过同源的 `GET /api/app-info` 查询。
