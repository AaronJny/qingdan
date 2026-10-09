# 青单 Android 0.1.0 源码与内置网页资源

独立安卓项目，应用基准为青单 1.0.1 源码 c3194463a8cf748242955c61da72969c652ea062。2026-10-09 仅清理自用界面文案并重建内置网页资源；产品名、Android 0.1.0 版本、包名 cn.qingdan.android、数据标识、业务处理与数据库迁移保持不变。

本次交付只有源码与预生成网页资源，没有新 APK。原 APK 签名私钥当前不可用，本次没有生成新签名密钥，不能据此声称可覆盖升级已安装应用。

当前唯一修改的应用源文件为 webapp/app/workspace-dialogs.tsx，SHA256：467c10cf0a629fccee3033bb8a683fb5e581baaff8c3d819a2367d526f295e0d。完整当前文件哈希见 ANDROID-SOURCE-MANIFEST.json，本次验证见 VERIFICATION.md；旧基准的验证记录仅供历史追溯。

## 两种模式

- 本地模式默认开启：APK 内置完整移动前端；复用原 Web Request/Response 业务 handlers，以 Android 原生 SQLite D1 适配及应用私有文件 bucket 提供数据持久化。身份是数据库内独立的 local:UUID。无需登录，不访问远程网络。本地协作/账号管理不可用。
- 私服账号模式：填写有效证书的 HTTPS 源地址，不支持路径前缀或 HTTP。不内置服务器、不创建账号；使用已部署青单账号模式私服及 HttpOnly 会话。页面/JS 由 APK 提供，API 才访问该服务器。此 WebView 不安装本地数据库/身份读取桥。只提供受限的分块导出桥，内容仍需用户在系统保存选择器确认写出。
- 两者不会自动迁移、合并或共用身份。账号缓存按服务器 origin 和账号 ID 隔离。本地 SQLite 不导入服务器数据库。切换模式保留各自的数据。

私服离线仅恢复已在线同步且主动启用的上次账号已加载副本；首次离线登录不支持。失效/拒绝/账号变化的会话不会当作本地免登录身份。离线输入是待核对的修改，不代表已在私服保存；附件与权限敏感操作须重新联网核对。

## 安卓适配

Android 8.0/API26 起，target/compile API36。内置 WebView 使用系统提供的较新版 WebView 组件（需支持现代ES2022/React19网页特性）；仅Android系统版本满足API26并不足以保证未更新的WebView可运行。返回键逐层关闭键盘/弹层/详情/导航，保留原有草稿；没有可关闭层时切到后台。原生 IME/安全区改变实际 WebView 高度。文件输入通过系统文档选择器；导出通过系统“保存到”选择器，没有全盘读写或相机权限。Blob 导出单文件上限25MiB，附件原业务上限20MiB。

通知目前只支持应用前台核对后发出的原生通知，Android13起由用户明确开启系统通知权限。没有后台轮询、服务器推送、准点闹钟或小米省电下必达保证。专注/倒数日仍使用绝对时间戳恢复进度。

## 构建

需要 JDK21、Gradle8.13、Android SDK Platform36/BuildTools36.0.0。Android SDK 工具和包的法律许可须自行阅读接受：https://developer.android.com/studio#command-tools 。本项目不会自动 yes --licenses、伪造许可文件或生成长期签名身份。

1. 在 webapp 执行 npm ci（标准 npm 注册源），或在锁文件一致情况下提供同一依赖图。
2. 项目根目录执行 node scripts/build-web.mjs。
3. 配置 JAVA_HOME 与 ANDROID_SDK_ROOT；在 android 执行 gradle assembleRelease。
4. 默认 release/debug 均未指定 signingConfig，不生成默认调试签名密钥。未签名APK不能直接安装。安装候选须使用明确授权的专用签名密钥；密钥不应放入源码包或APK。签名后用 apksigner verify --verbose --print-certs 验证。

## 测试与范围

verification/ 保留精简验证证据；scripts/ 与 tests/ 可复现相应检查。原业务测试与Node SQLite桥对照验证并不等同 Android 真机验证。原生单元测试须使用实际 bundled 驱动进行。SDK构建、APK签名、模拟器/小米14Ultra启动与后台权限需分别记录结果，不把未运行的步骤标作通过。

应用私有目录会被卸载/系统清除数据删除，请先使用完整备份导出。网页缓存清除按钮有独立确认，可清除私服会话/缓存/未同步输入，不会删除本地SQLite与附件。

## 源码目录

- webapp：独立适配的应用源；native/storage.ts、native/auth.ts、native/dispatch.ts 是安卓本地服务适配
- android：原生宿主及打包资产
- scripts/tests：可复现的构建与回归
- artifacts：验证日志和资产清单

不包含用户数据、账号、密码、私服地址、签名密钥、AndroidSDK或 node_modules。已修改文件与基准 SHA256 差异由 ANDROID-SOURCE-MANIFEST.json 列出。
