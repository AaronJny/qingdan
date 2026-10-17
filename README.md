# 青单

青单是可在本机或自己的服务器运行的任务与时间管理应用，提供清单、日历、习惯、专注计时和数据备份。

## 两种使用方式

- **本机模式**：桌面端自动启动内置服务，无需安装 Node.js 或输入账号密码。任务与附件保存在本机用户目录。
- **私服模式**：连接自己部署的青单服务器，使用该服务器创建的账号登录，供多设备访问。连接地址、会话和本机数据相互隔离，不会因为切换服务器自动上传或合并已有任务。

桌面端可从“设置 → 账号与同步 → 服务器连接”选择使用方式；菜单“文件 → 服务器连接”也可打开，快捷键为 `Cmd/Ctrl+,`。首次连接私服需要有效的 HTTPS 根地址。本机回环地址可用 HTTP。

## 功能

- 任务与子任务、清单与文件夹、标签、优先级、日期和重复规则
- 列表、看板、日历、四象限和时间线视图
- 习惯、番茄与正计时、统计、模板和倒数日
- 评论、附件、共享清单与账号隔离
- JSON、CSV、ICS 导入导出，以及包含附件的数据备份
- 可见的同步进度、结果和最近成功时间；出错与冲突保留输入供核对

## 目录

| 目录 | 内容 |
| --- | --- |
| `application/` | React 前端、Node.js 服务、数据库迁移和自动测试 |
| `desktop/` | Electron 桌面封装、内置后端资源和打包脚本 |
| `android/` | Android 容器及配套网页源码 |
| `server-packaging/` | 独立服务端启动、校验与交付脚本 |

## 从源码运行

需要 Node.js 24。

```sh
cd application
npm ci
npm run check
npm start
```

打开 `http://127.0.0.1:4310`。默认是仅允许本机访问的单人模式。

私服请先阅读 [服务端配置](application/README.md) 和 [账号说明](application/AUTH.md)。账号模式需要在部署机器初始化管理员，没有默认密码。公网访问应通过 HTTPS 反向代理，不应公开本机免登录模式。

桌面构建见 [桌面说明](desktop/README.md) 和 [构建流程](desktop/docs/BUILD-RELEASE.md)。Android 构建见 [Android 说明](android/README.md)。

跨端图标见 [品牌资源](docs/BRANDING.md)；分发构建应保留 [前端第三方声明](application/docs/THIRD-PARTY-NOTICES.md) 和相应平台已有的依赖许可。

1.1.0 的可靠性修复与本次验证见 [修复记录](docs/RELIABILITY-1.1.0.md)。

## 数据与备份

桌面用户目录稳定为 `QingdanDesktop`，本机数据库与附件位于其中的 `local-data`。正常退出后再复制整个用户目录备份。替换应用程序不应删除该目录。

私服按账号隔离数据。部署者应备份完整的数据目录，并妥善保管账号数据库。应用内导出文件不包含登录密码或会话。


## 自动发行

发布流水线构建 macOS arm64 DMG、Windows x64 便携 ZIP、Linux x64 AppImage、内置运行时与一键脚本的服务器 ZIP，以及 Android 可安装 release APK，并附 SHA256 和独立成品检查报告。桌面和服务端版本为 1.1.1；Android 独立客户端为 0.1.1，业务基准为 1.0.1。

发布请求通过 `.github/release/request.json` 明确指定版本；更新此文件、推送对应版本 tag 或手动运行“青单发布”工作流会构建发行，普通代码提交只做完整检查。只有五类成品齐备才正式发布；Android 签名未配置时只保留明确标注缺少 APK 的草稿。

Android 签名须由仓库所有者安全配置，见 [签名设置](android/docs/RELEASE-SIGNING.md)。密钥或密码不要进入聊天、源码或构建产物。macOS 当前没有 Developer ID 签名或 Apple 公证，Windows 未签名；请保留系统安全机制。构建、归档和后端检查不等同于桌面 GUI 或 Android 真机验收。
