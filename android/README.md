# 青单 Android 0.1.1

Android 是独立适配的客户端，内置业务源码基准仍为青单 1.0.1 / c3194463a8cf748242955c61da72969c652ea062。客户端版本为 0.1.1 / versionCode 2；包名 cn.qingdan.android、本地与私服数据身份及数据库迁移保持不变。此版本不等同桌面与服务端 1.1.1 的实现。

本次补齐可安装 APK 的构建、签名与验证流水线。构建默认仍输出 unsigned APK；只有用户已在 GitHub 安全配置的本应用专用签名身份才能签名，最终签名、版本、资源和原生库检查通过后才进入发布产物。原 APK 私钥不可用，改用新证书后不能直接覆盖旧签名安装。先在已有应用内导出完整备份；不要自动卸载旧应用，卸载会删除应用私有数据。

签名配置步骤见 [发布签名说明](docs/RELEASE-SIGNING.md)。秘密不得发送到聊天、提交源码或进入 APK/artifact。SDK/Gradle 构建与真实签名以对应 GitHub Actions 的运行结果和 APK 验证报告为准；本地源码/单元测试通过不等于已完成安装或真机测试。当前源码清单见 ANDROID-SOURCE-MANIFEST.json，历次验证见 VERIFICATION.md。

## 两种模式

- 本地模式默认开启：APK 内置完整移动前端；复用原 Web Request/Response 业务 handlers，以 Android 原生 SQLite D1 适配及应用私有文件 bucket 提供数据持久化。身份是数据库内独立的 local:UUID。无需登录，不访问远程网络。本地协作/账号管理不可用。
- 私服账号模式：填写有效证书的 HTTPS 源地址，不支持路径前缀或 HTTP。不内置服务器、不创建账号；使用已部署青单账号模式私服及 HttpOnly 会话。页面/JS 由 APK 提供，API 才访问该服务器。此 WebView 不安装本地数据库/身份读取桥。只提供受限的分块导出桥，内容仍需用户在系统保存选择器确认写出。
- 两者不会自动迁移、合并或共用身份。账号缓存按服务器 origin 和账号 ID 隔离。本地 SQLite 不导入服务器数据库。切换模式保留各自的数据。

私服离线仅恢复已在线同步且主动启用的上次账号已加载副本；首次离线登录不支持。失效/拒绝/账号变化的会话不会当作本地免登录身份。离线输入是待核对的修改，不代表已在私服保存；附件与权限敏感操作须重新联网核对。

## 安卓适配

Android 8.0/API26 起，target/compile API36。内置 WebView 使用系统提供的较新版 WebView 组件（需支持现代ES2022/React19网页特性）；仅Android系统版本满足API26并不足以保证未更新的WebView可运行。返回键逐层关闭键盘/弹层/详情/导航，保留原有草稿；没有可关闭层时切到后台。原生 IME/安全区改变实际 WebView 高度。文件输入通过系统文档选择器；导出通过系统“保存到”选择器，没有全盘读写或相机权限。Blob 导出单文件上限25MiB，附件原业务上限20MiB。

通知目前只支持应用前台核对后发出的原生通知，Android13起由用户明确开启系统通知权限。没有后台轮询、服务器推送、准点闹钟或小米省电下必达保证。专注/倒数日仍使用绝对时间戳恢复进度。

## 构建

需要 Node.js 24、JDK21（AGP最低为17）、Gradle8.13、已预装且已接受许可的 Android SDK Platform36 / BuildTools36.0.0。本项目禁用 Gradle SDK 自动下载，不运行 sdkmanager --licenses，不伪造许可文件，不在构建中生成签名密钥。GitHub ubuntu-24.04 提供这些 SDK 包；工作流在使用前逐一检查，缺少即停止。

1. 仓库根运行 npm ci --prefix android/webapp，使用该独立项目自己的锁文件。
2. 运行 npm run build:web --prefix android 和 npm run test:android --prefix android。
3. 运行 python3 -m unittest discover -s android/tests -p 'test_*.py' -v。
4. 配置 JAVA_HOME 与 ANDROID_HOME；运行 gradle -p android/android --no-daemon :app:securityTests :app:localStorePolicyTests :app:testReleaseUnitTest :app:assembleRelease。
5. 默认 release/debug 均没有 signingConfig。输出 android/android/app/build/outputs/apk/release/app-release-unsigned.apk 未签名，不能直接安装。可用 scripts/verify-apk.py 的 --structural-only 模式仅检查其资源与原生库，结果明确不是可安装候选。
6. 获准并提供四项 ANDROID_* 环境变量后，运行 bash android/scripts/sign-release.sh unsigned.apk signed.apk。脚本只在私密临时目录解码现有密钥；先做16KiB zipalign、用 apksigner v2/v3签名，再独立校验包名/版本/API、非debug构建、签名证书、16KiB ZIP/ELF对齐和当前资源。任何一步失败均不产出最终发布APK。

默认客户端版本为0.1.1/code2。构建可通过 QINGDAN_ANDROID_VERSION_NAME 与 QINGDAN_ANDROID_VERSION_CODE 传入已核对的发布版本，验证器使用同样的值。包名与数据身份不随版本变化。旧 prebuilt 资源清单仅作历史证据，当前发布必须重跑 build:web，不能直接复用旧网页文件。

## 测试与范围

verification/ 保留精简验证证据；scripts/ 与 tests/ 可复现相应检查。原业务测试与Node SQLite桥对照验证并不等同 Android 真机验证。原生单元测试须使用实际 bundled 驱动进行。SDK构建、APK签名、模拟器/小米14Ultra启动与后台权限需分别记录结果，不把未运行的步骤标作通过。

应用私有目录会被卸载/系统清除数据删除，请先使用完整备份导出。网页缓存清除按钮有独立确认，可清除私服会话/缓存/未同步输入，不会删除本地SQLite与附件。

## 源码目录

- webapp：独立适配的应用源；native/storage.ts、native/auth.ts、native/dispatch.ts 是安卓本地服务适配
- android：原生宿主及打包资产
- scripts/tests：可复现的构建与回归
- artifacts：验证日志和资产清单

不包含用户数据、账号、密码、私服地址、签名密钥、AndroidSDK或 node_modules。已修改文件与基准 SHA256 差异由 ANDROID-SOURCE-MANIFEST.json 列出。
