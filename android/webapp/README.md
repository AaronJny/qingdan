# 青单 Android 网页源码

此目录维护 Android 客户端的移动网页界面和本机服务适配，与 `application/` 独立构建。

## 构建

需要 Node.js 24。在仓库根目录执行：

```sh
npm ci --prefix android/webapp
npm run build:web --prefix android
npm run test:android --prefix android
```

`build:web` 会生成网页资源并同步到原生工程。APK 构建、签名与安装步骤见 [Android 说明](../README.md)。

## 目录

- `app/`、`web/`：移动端界面与入口
- `native/`：Android 本机模式的请求分发、身份与存储适配
- `lib/`、`assets/`：业务逻辑与导入导出工具
- `drizzle/`：数据库迁移，请保留已应用迁移的原始内容

私服账号与会话规则见 [账号说明](AUTH.md)，原生 WebView 与数据隔离策略见 [原生宿主说明](../android/README.md)。
