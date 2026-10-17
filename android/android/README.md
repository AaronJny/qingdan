# 青单 Android 主机

Android 客户端使用 Java Activity 和 APK 内置网页界面；默认本地免账号，另可连接用户自建 HTTPS 私服。最低 Android 8.0 / API 26，compile/target API 36。默认应用 ID：`cn.qingdan.android`。

## 构建

需要 JDK 17+（发布流水线使用21）、Gradle 8.13、已预装并已接受许可的 Android SDK Platform 36 / Build Tools 36.0.0。插件固定为 AGP 8.12.0。构建禁用 SDK 自动下载，不接受 SDK 许可、不生成签名密钥。客户端默认版本0.1.1 / versionCode2，应用 ID 和数据身份保持不变。

1. 在仓库根按项目 Android 打包脚本生成 SPA。输出仅放入 `app/src/main/assets/web/`，必须包含 `index.html`、`assets/`、favicon。
2. 将上游 `webapp/drizzle/*.sql` 原字节复制到 `app/src/main/assets/migrations/`。请保留 SQL 原文，以免迁移校验失败。
3. 在 `local.properties` 指定已有 SDK 的 `sdk.dir`，或使用环境变量 `ANDROID_HOME`。
4. 在此目录运行 `gradle :app:assembleRelease`。产物 `app/build/outputs/apk/release/app-release-unsigned.apk` **未签名，不能直接安装**。安装前须使用自己的签名密钥完成签名；debug 也明确不签名。仓库根的 android/scripts/sign-release.sh 只使用用户安全配置的四项 ANDROID_* 输入，签名后必须通过独立验收才输出最终APK。参见 ../docs/RELEASE-SIGNING.md。
5. 纯 JVM 安全测试：`JAVA_HOME=/path/to/jdk ./test-security.sh`，无需 SDK。

未包含未经验证的 wrapper JAR；`gradle/wrapper/gradle-wrapper.properties` 固定官方 8.13 分发地址，构建使用已有 Gradle 8.13。

## 模式与数据

- **本地模式**：保留的 `https://local.qingdan.invalid` 源，无账号、无网络 API、无服务器同步。数据在应用私有 SQLite 与对象文件中；只有 APK 页面可使用 `QingdanLocal.invoke`。官方 `androidx.sqlite:sqlite-bundled:2.6.2` 提供固定 SQLite 引擎，避免系统版本 JSON/事务差异。它是本包唯一数据库引擎，未动态加载扩展。
- **私服账号模式**：用户输入确切 HTTPS 源（域名和可选端口，不带用户名、路径、query 或 fragment）。保留 local host 不接受为服务器。只在该源 `/api` 路径联网，登录凭据由服务端响应和 WebView 同源 HttpOnly Cookie 处理。原生没有本地身份或读取桥；只有写入导出字节、由用户选择目标的窄 QingdanExport 通道。
- 切换销毁旧 WebView、移除 bridge 并关闭 local connection。保存的设置仅模式与非敏感端点，不保存密码。不会迁移/合并/清除旧源数据；每个源的 Cookie/DOM/IndexedDB 保持源隔离。返回原源可继续旧会话，服务端仍须校验账号与权限。
- 原生“清除本机网页数据”有独立、不可撤回提示，会清所有模式网页缓存、Cookie、IndexedDB、网页草稿；不会删除本地 SQLite/对象文件或服务器数据。
- 自动云备份和设备迁移排除本应用私有数据。卸载仍由 Android 删除应用私有数据；应先用应用导出功能制作备份。

## 主机边界

- 主文档 `/` 始终来自 APK。只允许内置 `/assets/*` 和 favicon；远程登录页/HTML、未知地址、主框架 `/api`、子框架、file/content/cleartext/intent 等导航拒绝。
- 内容安全策略限制可执行脚本为 APK `/assets/`，禁 eval、inline scripts、frame、worker、object 和表单导航。允许 UI 必需 inline 样式和受限 data/blob 图片。原生只注入固定生命周期/返回回调，不执行服务器脚本。
- 私服没有 `QingdanLocal` 身份/数据库桥。唯一通用 `QingdanExport` bridge 仅接收导出字节，不提供读取、身份、SQL 或网络功能。本地 bridge 只在保留源安装；远程切换先移除 bridge，绝不把私服缓存账号降级成本地身份。
- 私服 GET/HEAD 在原生做受限 HTTPS 请求，每次 redirect 重新检查同源 `/api`，保留精确账号/CSRF 请求头及同源 Cookie，最多三次 redirect，响应上限 25 MB/90 秒。其他方法需原 WebView 栈保留 body；APK fetch 必须固定 `redirect:'error'`，拒绝 30x。无自定义证书绕过、HTTP 回退或外域 redirects。
- 禁 file/content 与 file-origin universal access，拒 SSL 错误、mixed content、地理位置、摄像头/麦克风等 WebView 权限。仅 INTERNET 和可选 POST_NOTIFICATIONS 权限，无广域文件、相机或后台闹钟权限。
- Android 上本地 GET image 的 `/api/countdown-background` 和 `/api/attachments` 是私有 SQLite/object 查询响应，**不联网**；本地其他 API 由 APK JS dispatcher 调用 bridge。
- 导入用 `ACTION_OPEN_DOCUMENT`，只交付用户本次选择的 content URI，不获取广域存储权限、不保存长期 URI grants。
- 保存用 `ACTION_CREATE_DOCUMENT`。Blob 导出通过前台受信任 APK 主文档的窄 `QingdanExport` 分块写入（32 KiB/chunk，总 25 MiB，随机 nonce，五分钟截止），完成后才显示保存选择器；不提供私有内容读取。兼容 `qingdanapp://export` 导航限制到 1 MiB，避免 Chromium 超长 URL 限制。切换销毁通道并清零内存。私服 HTTP 文件只下载同源 HTTPS `/api`，每次 redirect 重新校验并限制大小/时间。失败可能留下不完整的用户目标文件，应用不会悄悄删除它。
- 前台可选择系统通知权限并显示计时通知；无精确后台通知承诺、无 alarm、boot receiver 或后台服务。

## 手机行为

- Android Back 调用 APK `window.__qingdanAndroidBack()`。返回 `true` 表示关闭面板；否则将 Activity 移到后台。API 33+ 注册新 Back API。
- `window.__qingdanAndroidLifecycle('resume'|'pause')` 与 WebView lifecycle 一起派发，计时使用应用自身 epoch 算法。
- API 30+ 使用系统栏、cutout、IME native insets 设置实际 WebView 可见 viewport；API 26-29 使用 adjustResize 并补偿 OEM 覆盖键盘。需在 Xiaomi 14 Ultra 实测输入法、长编辑、导航返回、导入/导出取消与锁屏恢复。

## 第三方与 ABI

固定官方 AndroidX SQLite 2.6.2，Apache-2.0 许可随项目 `THIRD-PARTY-NOTICES.md` 和 `licenses/Apache-2.0.txt` 保留。SQLite 上游为 public domain。标准 AAR 的 JNI 库由 Android Gradle 打包，不以系统 SQLite 替代；不设置 ABI 过滤；首次成功 release APK 中已检查 arm64-v8a、armeabi-v7a、x86、x86_64 四种 ABI。各 JNI ELF LOAD segment 的 p_align 均为 0x4000（16 KiB），最终签名 APK 还需检查 zip/page 对齐。Xiaomi 14 Ultra 使用 arm64-v8a；构建后须检查 APK 中对应 JNI 库及 16 KB page-size 兼容性。其他 ABI 与包大小以实际 AAR/最终 APK 清单为准，不声称已做跨 ABI 真机测试。

参考：[AGP 8.12/API 36 支持](https://developer.android.com/build/releases/agp-8-12-0-release-notes)、[WebViewClient](https://developer.android.com/reference/android/webkit/WebViewClient)、[WebChromeClient 文件选择](https://developer.android.com/reference/android/webkit/WebChromeClient)、[AndroidX SQLite 2.6.2](https://developer.android.com/jetpack/androidx/releases/sqlite)、[edge-to-edge/insets](https://developer.android.com/develop/ui/views/layout/edge-to-edge)。
