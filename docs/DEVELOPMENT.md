# Development and deployment / 开发与部署

Technical setup and build references for contributors and server administrators. For product features and downloads, see [English](../README.md) or [简体中文](../README.zh-CN.md).

## Run from source


Requires **Node.js 24** and npm. From the repository root, run:

```sh
cd application
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4310`. By default, the app runs in single-user mode accessible only from the local machine. The default data directory is `application/data/local`; set `QINGDAN_DATA_DIR` to use a separate directory.

See [application/README.md](../application/README.md) for self-hosting configuration, environment variables, Docker Compose, and development instructions.

## 从源码运行


需要 **Node.js 24** 和 npm。在仓库根目录执行：

```sh
cd application
npm ci
npm run build
npm start
```

打开 `http://127.0.0.1:4310`，默认进入仅本机可访问的单人模式。默认数据目录为 `application/data/local`，可通过 `QINGDAN_DATA_DIR` 指定独立目录。

私服配置、环境变量、Docker Compose 和开发说明见 [application/README.md](../application/README.md)。

## Technical references


| Directory / document | Contents |
| --- | --- |
| [application/](../application/README.md) · [Account guide](../application/AUTH.md) | React frontend, Node.js server, database migrations, accounts, and deployment configuration |
| [desktop/](../desktop/README.md) · [Build and release guide](../desktop/docs/BUILD-RELEASE.md) | Electron desktop wrapper, built-in backend, and platform-specific packaging |
| [android/](../android/README.md) · [Signing setup](../android/docs/RELEASE-SIGNING.md) | Native Android shell, separate web app source, building, and signing |
| [server-packaging/](../server-packaging/BUILD.md) | Server ZIP with bundled runtimes and launch scripts |
| [Brand assets](../docs/BRANDING.md) | Green clipboard icons for the web, desktop, and Android apps |
| [Frontend third-party notices](../application/docs/THIRD-PARTY-NOTICES.md) · [DMG toolchain notices](../desktop/scripts/dmg/toolchain/THIRD-PARTY-NOTICES.md) | Third-party licenses and notices that must be retained when distributing the software |

## 技术文档索引


| 目录 / 文档 | 内容 |
| --- | --- |
| [application/](../application/README.md) · [账号说明](../application/AUTH.md) | React 前端、Node.js 服务、数据库迁移、账号与部署配置 |
| [desktop/](../desktop/README.md) · [构建流程](../desktop/docs/BUILD-RELEASE.md) | Electron 桌面封装、内置后端和各平台打包 |
| [android/](../android/README.md) · [签名设置](../android/docs/RELEASE-SIGNING.md) | Android 原生容器、独立网页源码、构建与签名 |
| [server-packaging/](../server-packaging/BUILD.md) | 含运行时的服务端 ZIP 与启动脚本 |
| [品牌资源](../docs/BRANDING.md) | 网页、桌面与 Android 绿色剪贴板图标 |
| [前端第三方声明](../application/docs/THIRD-PARTY-NOTICES.md) · [DMG 工具链声明](../desktop/scripts/dmg/toolchain/THIRD-PARTY-NOTICES.md) | 分发时需要保留的第三方许可与声明 |
