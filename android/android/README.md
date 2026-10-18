# Android 原生宿主开发说明

原生宿主使用 Java Activity 和 APK 内置网页界面，支持本机离线使用与 HTTPS 私服连接。应用 ID 为 `cn.qingdan.android`，最低 Android 8.0 / API 26，compile/target API 36。安装和日常使用见 [Android 使用说明](../README.md)。

## 构建

需要 JDK 17 及以上（发布流水线使用 JDK 21）、Gradle 8.13，以及已安装并接受许可的 Android SDK Platform 36 / Build Tools 36.0.0。Android Gradle Plugin 固定为 8.12.0。

1. 在仓库根目录执行 `npm ci --prefix android/webapp` 和 `npm run build:web --prefix android`，生成 `app/src/main/assets/web/` 下的网页资源与 `app/src/main/assets/migrations/` 下的数据库迁移。不要修改已应用迁移的 SQL 原文。
2. 通过 `ANDROID_HOME` 或 `local.properties` 中的 `sdk.dir` 指定 SDK。构建不自动下载 SDK 或接受许可。
3. 在此目录运行 `gradle :app:assembleRelease`。输出为 `app/build/outputs/apk/release/app-release-unsigned.apk`，需签名后才能安装。debug 构建同样不自动签名。
4. 签名前设置 `ANDROID_HOME`（或 `QINGDAN_ANDROID_BUILD_TOOLS`），按 [发布签名说明](../docs/RELEASE-SIGNING.md) 配置四项 `ANDROID_*` 签名环境变量，再运行 `bash ../scripts/sign-release.sh app/build/outputs/apk/release/app-release-unsigned.apk ../artifacts/Qingdan-signed.apk`。输出路径必须尚不存在。签名密钥与密码不得写入源码或构建产物。

版本通过 `QINGDAN_ANDROID_VERSION_NAME` 和 `QINGDAN_ANDROID_VERSION_CODE` 设置，默认值见 `app/build.gradle`。构建使用已安装的 Gradle 8.13；仓库不包含 wrapper JAR。

无需 Android SDK 的 JVM 测试：

```sh
JAVA_HOME=/path/to/jdk ./test-security.sh
```

## 模式与数据

- **本机模式**使用保留来源 `https://local.qingdan.invalid`。数据保存在应用私有 SQLite 与对象文件中，不访问网络 API。只有 APK 内置页面可调用 `QingdanLocal.invoke`；数据库引擎为 `androidx.sqlite:sqlite-bundled:2.6.2`。
- **私服模式**仅接受 HTTPS 根地址，可以带端口，不接受用户名、路径、查询或片段。请求限于该来源的 `/api`；登录由服务器和 WebView 的 HttpOnly Cookie 处理。此模式不提供 `QingdanLocal` 数据读取桥。
- **切换模式**会销毁旧 WebView、移除桥接并关闭本机连接。设置只保存模式和服务器地址；各来源的 Cookie、DOM Storage 和 IndexedDB 分别保留，任务不会自动迁移或合并。
- **清除本机网页数据**会删除所有模式的网页缓存、Cookie、IndexedDB 和网页草稿。操作需要确认，不删除本机 SQLite、附件文件或服务器数据。
- 应用私有数据不参与 Android 自动云备份或设备迁移。卸载或清除应用数据前，应通过应用导出备份。

## WebView 与网络

主页面始终来自 APK，仅内置 `/assets/*` 和 favicon 可作为页面资源。远程 HTML、未知地址、子框架及 `file:`、`content:`、明文 HTTP、`intent:` 导航均被拒绝。CSP 仅允许 APK 资源执行脚本，禁止 eval、内联脚本、frame、worker、object 和表单导航。

私服 GET/HEAD 请求由原生 HTTPS 请求处理，最多跟随三次重定向，每次都校验同源 `/api`，响应上限为 25 MB、90 秒。其他方法由 WebView 发送请求体，网页请求固定 `redirect:'error'`。不支持证书错误绕过、HTTP 回退或跨来源重定向。

本机 `/api/countdown-background` 和 `/api/attachments` 图片请求读取私有数据；其余本机 API 由网页 dispatcher 调用原生桥。

权限仅包含 INTERNET 和可选的 POST_NOTIFICATIONS。WebView 拒绝地理位置、摄像头、麦克风及广域文件访问。

## 文件与导出

导入通过 `ACTION_OPEN_DOCUMENT` 获取用户本次选择的文件，不获取全盘权限或长期 URI 授权。

导出通过 `QingdanExport` 接收字节，再调用 `ACTION_CREATE_DOCUMENT` 让用户选择目标。该桥不提供数据读取、身份、SQL 或网络能力。导出按 32 KiB 分块，总量上限 25 MiB，使用随机 nonce，五分钟内完成；切换模式时销毁导出通道。兼容的 `qingdanapp://export` 方式上限为 1 MiB。

私服文件下载仅允许同源 HTTPS `/api`，每次重定向重新校验地址，并限制大小与耗时。保存失败时可能留下不完整的目标文件，需由用户检查。

## 手机交互

- 返回键调用 `window.__qingdanAndroidBack()`。返回 `true` 表示已关闭页面内面板，否则将 Activity 移到后台。API 33 及以上使用新版 Back API。
- 生命周期通过 `window.__qingdanAndroidLifecycle('resume'|'pause')` 通知网页，并同步 WebView 状态。
- API 30 及以上使用系统栏、刘海和输入法 insets 设置可见区域；API 26–29 使用 `adjustResize` 并补偿键盘遮挡。
- 通知需要应用页面保持打开且可见。未实现后台服务、开机接收器或精确闹钟。

## 第三方与 ABI

AndroidX SQLite 2.6.2 使用 Apache-2.0 许可，声明随 `THIRD-PARTY-NOTICES.md` 和 `licenses/Apache-2.0.txt` 保留。SQLite 上游为 public domain。

JNI 库由 Android Gradle 从标准 AAR 打包，未设置 ABI 过滤。发布前检查最终 APK 的 ABI 清单、JNI 库及 16 KiB page-size 对齐；设备测试步骤见 [原生测试说明](tests/README.md)。

参考：[AGP 8.12/API 36 支持](https://developer.android.com/build/releases/agp-8-12-0-release-notes)、[WebViewClient](https://developer.android.com/reference/android/webkit/WebViewClient)、[WebChromeClient 文件选择](https://developer.android.com/reference/android/webkit/WebChromeClient)、[AndroidX SQLite 2.6.2](https://developer.android.com/jetpack/androidx/releases/sqlite)、[edge-to-edge/insets](https://developer.android.com/develop/ui/views/layout/edge-to-edge)。
