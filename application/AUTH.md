# 本地账号与会话

`APP_MODE=local`（默认）为本机免账号模式；`APP_MODE=accounts` 为带账号和管理员管理的私有服务器模式。没有默认密码或公开注册接口。

本机模式只允许回环地址访问，自动使用数据目录中持久的 `local:<uuid>` 身份，不创建密码账号，不需要初始化管理员，也不开放账号管理。`/api/auth/me` 返回本地主体和每次服务启动新生成的 CSRF 值，不设置认证 Cookie。服务同时校验来源、Host、自定义请求头和 CSRF；重启后打开的页面需刷新更新 CSRF。

两个模式默认目录分别为 `./data/local` 和 `./data/accounts`。每个目录持久记录模式，本机主体与目录绑定。把 APP_MODE 改成另一模式不能把原目录变成免登录目录，服务会拒绝启动；没有模式标记的非空旧目录也不会自动认领。需要改变模式时，明确导出数据并导入新的独立目录。

## 初始化与管理

在账号模式部署服务器的交互终端运行（Node.js 24；APP_MODE 与服务进程配置一致）：

```sh
APP_MODE=accounts node --experimental-strip-types scripts/users.ts init-admin
APP_MODE=accounts node --experimental-strip-types scripts/users.ts add-user
APP_MODE=accounts node --experimental-strip-types scripts/users.ts add-user --admin
APP_MODE=accounts node --experimental-strip-types scripts/users.ts reset-password
APP_MODE=accounts node --experimental-strip-types scripts/users.ts disable-user
```

首次运行按提示输入邮箱、姓名和密码。密码不回显，必须输入两次；不接受命令参数、环境变量或管道中的密码。`init-admin` 只能在没有任何账号时运行。创建其他账号需要已有启用的管理员。不能停用或降低最后一位启用管理员的角色。重设密码、停用账号和调整角色都会撤销该账号已有会话。CLI 是拥有服务器文件访问权限的部署者管理入口；账号模式中已登录管理员还可以在应用账号管理界面进行常规操作。

共享存储 provider 首次使用时执行 `drizzle/0000` 至 `0005` 迁移；认证表为 `auth_users`、`auth_sessions`、`auth_login_limits`。设置 `QINGDAN_DATA_DIR` 可指定部署数据目录，保持与服务进程的设置相同。真实数据目录及备份应仅供部署者访问。

## 服务配置

`APP_ORIGIN` 是浏览器实际访问的完整来源，例如 `http://127.0.0.1:4310` 或 `https://tasks.example.com`，不带路径。默认值为 `http://127.0.0.1:4310`。HTTP 只允许 localhost、127.0.0.1 和 ::1 等本机回环地址。私有服务器通过反向代理提供 HTTPS，并把 APP_ORIGIN 配为外部 HTTPS 来源；不信任客户端的 Host 或 forwarded 头来决定来源、Cookie 安全属性。

账号模式 HTTPS 使用 `__Host-qingdan_session`，设置 Secure、HttpOnly、SameSite=Strict、Path=/，不设置 Domain。本机 HTTP 账号模式使用 `qingdan_session`，其余属性相同。会话绝对有效期为 7 天，连续闲置 12 小时失效。登录生成新的 256 位随机令牌，数据库只存 SHA-256 摘要。退出登录立即删除服务器端会话。

密码使用 Node.js 内置异步 scrypt：N=131072、r=8、p=1，16 字节随机盐和 32 字节派生结果；密码比较使用 timingSafeEqual。每次派生约需 128 MiB 内存，单进程同时最多进行两次派生。新密码为 15–128 个字符，允许中文和空格，不裁剪、不自动改变密码。暂未实现 MFA、邮件找回或邮箱所有权验证；邮箱用于本地身份与协作邀请匹配，由部署者确认。

每邮箱 15 分钟最多尝试 5 次，单部署数据库每分钟最多尝试 50 次；成功登录清除该邮箱的失败窗口。限流保存在数据库中，重启服务不会清空。全局限制不依赖未经确认的代理 IP，适合小型私有部署；较大组织需要独立配置上游限流和认证方案。

## 同源 API 合同

- GET `/api/auth/me` 返回 `{mode,user,csrfToken}`；账号模式未登录时后两项为 null，本机模式自动有本地主体。
- 账号模式 POST `/api/auth/login` 发送 JSON `{email,password}`，带 `x-qingdan: 1`，Origin 必须精确等于 APP_ORIGIN。成功返回 `{mode,user,csrfToken}` 并设置会话 Cookie。
- 账号模式 POST `/api/auth/logout` 以及两个模式的全部业务写入带 `x-qingdan: 1` 和 `x-qingdan-csrf: <csrfToken>`，并需要匹配的 Origin。退出返回 `{mode,user:null,csrfToken:null}` 并清除 Cookie。
- user 为 `{userId,email,displayName,fullName,role}`，userId 为持久本地 UUID，role 为 admin 或 user。管理员身份不赋予其他用户任务数据的所有权。

账号模式 csrfToken 是从 HttpOnly 会话令牌按固定命名空间派生的 SHA-256 摘要，不是会话令牌本身。每次新登录都会变化。服务严格验证来源、请求自定义头和摘要，并继续验证数据库会话；不开放跨域 CORS。客户端不得把密码或会话令牌写入日志或本地存储。

账号管理仅在 accounts 模式中对已登录启用的管理员开放：

- GET `/api/auth/users` 返回 `{users}`，每项仅有身份字段、disabled 布尔值、createdAt ISO 时间，不返回密码摘要或会话。
- POST `/api/auth/users` 发送 `{operation:'create',email,displayName,password,role?}` 创建账号，默认 user；或 `{operation:'disable'|'enable'|'role'|'password',userId,role?,password?}` 操作现有账号。新密码由管理员主动输入，不预置。
- 该接口所有写操作也要求同源和 CSRF。响应为 `{ok:true,user}`。管理员只能管理账号，业务记录的 owner/member 授权保持独立。

运行 `node --experimental-strip-types --test lib/auth.test.ts` 检查账号与会话逻辑。测试使用独立临时目录。

依据：[Node.js 24 crypto.scrypt](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)、[OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[OWASP 会话管理](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[OWASP CSRF 防护](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)。这些是认证功能的设计依据；不代表整个产品已经过独立安全审计。
