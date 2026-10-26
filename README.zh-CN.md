# 青单

[English](README.md) · **简体中文**

青单是可在本机或自有服务器运行的任务与时间管理应用，把清单、日历、习惯和专注计时放在一个工作台。支持免登录的本机使用，也可部署私服，在多台设备间同步。

[下载发行版](https://github.com/AaronJny/qingdan/releases/latest) · [界面截图](#界面截图) · [使用方式](#本机模式与私服模式) · [数据备份](#数据与备份)

## 主要功能

- **任务与笔记**：清单、文件夹、子任务、检查项、标签、优先级、富文本与 Markdown 描述
- **计划与视图**：列表、看板、日历、时间线、四象限，支持日期、时间、重复规则和提醒设置
- **习惯与专注**：习惯目标与打卡、番茄计时、正计时、专注记录与统计
- **日常工具**：模板、倒数日、搜索与自定义筛选
- **协作与附件**：私服账号、共享清单、成员权限、评论、动态与附件
- **数据管理**：JSON、CSV、ICS 导入导出，包含附件的完整备份，可见的同步状态与冲突核对

协作能力需要账号模式私服。本机模式不需要登录；切换私服不会自动上传、合并或迁移本机数据。

### 界面语言

支持简体中文、繁體中文、English、日本語、한국어、Español、Français、Deutsch 和 Português (Brasil)。在“设置 → 通用 → 语言”中切换，也可跟随系统；未支持的系统语言使用英文。

语言设置仅对当前设备或浏览器生效，任务和笔记内容保留原文。快速录入支持简体中文和英文日期命令，也可使用日期选择器。

## Agent 访问

通过桌面客户端统一中转，让支持 MCP 的 Agent 访问选定的本地或私服清单。默认关闭访问，按清单授权，且仅对本次桌面会话有效。配置步骤见 [Agent 访问指南](docs/AGENT-ACCESS.zh-CN.md)。桌面客户端与所连接的私服均需 v1.3.8 或更新版本。

## 界面截图

### 任务工作台

按日期安排任务，用清单和标签整理工作与生活。

![青单任务工作台：所有任务、工作与生活清单、标签和日期分组](docs/screenshots/tasks.jpg)

<details>
<summary>查看日历、四象限和习惯截图</summary>

### 日历安排

月历展示已有任务，右侧保留待安排事项。

拖动任务中间可整体移动；拖动左边缘调整开始日期、右边缘调整结束日期，支持跨周行。

![青单日历：月视图、任务日期与待安排任务](docs/screenshots/calendar.jpg)

### 四象限

按优先级与日期整理注意力，并可配置象限规则。

![青单四象限：重要且紧急、重要不紧急、不重要但紧急、不重要不紧急](docs/screenshots/matrix.jpg)

### 习惯打卡

查看每日目标、当周记录、连续次数与近 30 天完成情况。

![青单习惯：阅读目标、打卡记录与完成率](docs/screenshots/habits.jpg)

</details>

## 下载与安装

前往 [Releases](https://github.com/AaronJny/qingdan/releases/latest) 下载适合自己系统的版本。当前发行版为 [v1.3.10](https://github.com/AaronJny/qingdan/releases/tag/v1.3.10)，包含桌面端、服务端和 Android 客户端。

| 平台 | 下载 | 使用方式与要求 |
| --- | --- | --- |
| macOS · Apple Silicon | [arm64 DMG](https://github.com/AaronJny/qingdan/releases/download/v1.3.10/Qingdan-1.3.10-mac-arm64.dmg) | macOS 13 及以上；正常退出旧版后，将应用拖入 Applications |
| macOS · Intel | [x64 DMG](https://github.com/AaronJny/qingdan/releases/download/v1.3.10/Qingdan-1.3.10-mac-x64.dmg) | macOS 13 及以上；将应用拖入 Applications |
| Windows · x64 | [便携 ZIP](https://github.com/AaronJny/qingdan/releases/download/v1.3.10/Qingdan-1.3.10-win-x64.zip) | 完整解压后运行 `Qingdan.exe`，不要只复制 EXE |
| Linux · x64 | [AppImage](https://github.com/AaronJny/qingdan/releases/download/v1.3.10/Qingdan-1.3.10-linux-x64.AppImage) | 添加可执行权限后运行；系统要求与 FUSE 启动说明见[桌面说明](desktop/README.md) |
| 自托管服务端 / 网页端 | [含运行时 ZIP](https://github.com/AaronJny/qingdan/releases/download/v1.3.10/qingdan-server-v1.3.10.zip) | 内置 Linux x64 / macOS arm64 运行时和启动脚本，无需另外安装 Node.js 或 npm |
| Android | [0.3.9 APK](https://github.com/AaronJny/qingdan/releases/download/v1.3.10/Qingdan-0.3.9-android.apk) | Android 8.0 及以上，并需保持系统 WebView 更新；安装与签名注意事项见[Android 说明](android/README.md) |

### 已知平台限制

- macOS 版本尚无 Developer ID 签名或 Apple 公证，Windows 版本尚无发布者签名，系统可能阻止运行。遇到安全警告时，请先核实下载来源，保留系统安全设置。
- Android 更新需要签名一致。升级前先导出完整备份；不要直接卸载旧应用，卸载会删除其私有数据。
- 提醒和计时铃声需要保持应用页面打开且可见。Android 暂不支持后台推送或准点闹钟。

## 本机模式与私服模式

### 本机使用

桌面端会自动启动内置服务，无需安装 Node.js、手动运行命令或输入账号密码。任务与附件保存在本机用户目录。

服务端 ZIP 也可作为本机网页版使用：解压后阅读根目录的运行说明，macOS 运行 `start.command`，Linux 运行 `start.sh`，并在服务运行期间使用浏览器访问本机地址。

本机模式仅供当前设备使用；如需其他设备访问，请使用账号模式私服。

### 连接自有服务器

使用账号模式部署服务后，桌面端可从“设置 → 账号与同步 → 服务器连接”或菜单“文件 → 服务器连接”（`Cmd/Ctrl+,`）填写服务器地址，再使用该服务器创建的账号登录。请使用管理员提供的 HTTPS 服务器地址。

请联系服务器管理员创建账号。各服务器、各账号和本机模式的数据分别保存，切换不会自动迁移。如需自行部署，参阅[私服部署说明](application/README.md)。

## 数据与备份

- **桌面端**：稳定用户目录为系统应用数据目录下的 `QingdanDesktop`，本机数据库与附件位于其中的 `local-data`。备份前正常退出应用，再完整复制用户目录；升级时保留该目录。
- **独立服务端**：先停止服务，再完整复制数据目录。不要只备份数据库文件，也不要让本机与账号模式共用数据目录。
- **Android**：卸载或系统清除数据会删除应用私有数据，请提前通过应用导出完整备份。
- 应用内任务导出不包含登录密码或会话；实例目录备份可能包含账号与会话等私密信息，应自行妥善保管。

## 许可证

青单采用 [AGPL-3.0-only](LICENSE)。分发软件或提供修改后的网络服务时，须遵守相应的源码提供要求；详情及第三方声明见[许可说明](application/docs/LICENSING.md)。

开发者与服务器管理员可参阅[开发与部署文档](docs/DEVELOPMENT.md)。
