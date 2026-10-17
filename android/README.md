# 青单 Android

支持 Android 8.0 及以上。客户端内置移动端界面，可离线使用本机模式，也可连接自己的青单 HTTPS 私服。请保持系统 WebView 更新，以正常使用应用界面。

## 安装与升级

在 [Releases](https://github.com/AaronJny/qingdan/releases/latest) 下载 APK 并安装。

**不同签名的 APK 无法覆盖安装。** 升级前先在旧应用内导出完整备份；如安装时提示签名不兼容，请备份后再卸载旧版、安装新版并导入。卸载或系统清除数据会删除应用私有数据。如果完整备份提示超限，请先保留旧应用，另行保存所需记录和附件，确认备份可用后再卸载。

Android 客户端单独维护，部分功能与桌面端、服务端有所不同。

## 使用方式

- **本机模式**：默认开启，无需登录。任务与附件保存在应用私有目录，可离线使用；共享清单和账号管理需要私服。
- **私服模式**：填写有效证书的 HTTPS 根地址，使用该服务器的账号登录。不支持 HTTP 或带路径前缀的地址。账号需由服务器管理员创建。
- 本机和私服数据分别保存，切换模式不会自动迁移或合并任务。

启用离线副本后，可在断网时查看上次同步且已加载的账号数据。首次登录需要联网；离线修改需在重新联网后核对，附件与共享权限相关操作也需要联网。

## 手机操作

- 返回键依次关闭键盘、弹层、详情和导航；没有可关闭的页面时，将应用切到后台。
- 导入文件使用系统文件选择器，导出使用系统“保存到”选择器，无需全盘读写权限。
- 单个附件上限为 20 MiB，单个导出文件上限为 25 MiB。
- 提醒需要保持应用页面打开且可见。Android 13 及以上需开启通知权限；暂不支持后台推送或准点闹钟。
- “清除本机网页数据”会清除私服会话、网页缓存及未同步输入，请先备份；不会删除本机 SQLite 数据库与附件。

## 从源码构建

需要 Node.js 24、JDK 21、Gradle 8.13，以及已安装并接受许可的 Android SDK Platform 36 / Build Tools 36.0.0。

在仓库根目录执行：

```sh
npm ci --prefix android/webapp
npm run build:web --prefix android
npm run test:android --prefix android
python3 -m unittest discover -s android/tests -p 'test_*.py' -v
```

配置 `JAVA_HOME` 和 `ANDROID_HOME` 后构建原生应用：

```sh
gradle -p android/android --no-daemon :app:securityTests :app:localStorePolicyTests :app:testReleaseUnitTest :app:assembleRelease
```

默认输出 `android/android/app/build/outputs/apk/release/app-release-unsigned.apk`，未签名，不能直接安装。配置发布签名后，使用 `android/scripts/sign-release.sh` 签名并检查 APK，具体步骤见 [发布签名说明](docs/RELEASE-SIGNING.md)。密钥与密码请通过安全配置提供，不要写入源码或构建产物。

构建版本可通过 `QINGDAN_ANDROID_VERSION_NAME` 和 `QINGDAN_ANDROID_VERSION_CODE` 指定。打包前需重新运行 `build:web`，生成与当前源码一致的网页资源。

## 源码目录

- `webapp/`：移动端网页与本机存储适配
- `android/`：原生宿主与打包资源
- `scripts/`、`tests/`：构建脚本与回归测试
- `verification/`：构建与平台测试记录

原生架构、WebView 安全策略和设备测试项目见 [原生宿主说明](android/README.md)。
