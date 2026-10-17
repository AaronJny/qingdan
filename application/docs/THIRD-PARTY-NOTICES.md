# 前端依赖声明

应用前端构建沿用 Android 网页构建的做法：从构建模块图读取 npm 包名和精确版本，并把安装包中的 LICENSE、LICENCE、COPYING、NOTICE 文件原文写入成品。保留完整模块图中的依赖，也覆盖被构建器内联的模块。缺少或空白的许可文件会使构建失败，不能以一句许可名称代替原文。

`npm run build` 生成：

- `dist/client/assets/licenses/WEB-DEPENDENCY-LICENSES.txt`：主前端的依赖许可与版权声明。
- `dist/client/assets/licenses/WEB-DEPENDENCY-VERSIONS.json`：对应包名、版本、许可和原始声明文件名。
- `dist/client/offline-assets/WEB-DEPENDENCY-LICENSES.txt` 和 `WEB-DEPENDENCY-VERSIONS.json`：独立离线壳的对应声明，随离线静态资源一起保留。

桌面和服务器打包保留整个 `dist/client`，因此这些文件会进入相应成品。分发时不要删除这些声明。清单覆盖对应前端构建模块图中的 npm 包；Node.js、Electron、Android 和其他平台运行依赖仍需保留各自已有的许可文件。这些声明仅说明第三方依赖，不决定青单自有代码的许可。

## ical.js

锁定的 `ical.js` 版本为 2.2.1，许可为 MPL-2.0。完整许可文本另保留在 [licenses/ical.js-MPL-2.0.txt](licenses/ical.js-MPL-2.0.txt)。本项目未修改该包；npm 原始分发包包含其 `lib/ical/` 源码：

- 精确版本源码包：https://registry.npmjs.org/ical.js/-/ical.js-2.2.1.tgz
- 上游仓库：https://github.com/kewisch/ical.js

如果某个前端构建包含 `ical.js`，生成的声明也会提供与实际安装版本一致的源码包链接和完整许可。服务器运行依赖按自己的清单保留该包；发布者应把此源码获取说明与相应成品一起提供。升级或修改 `ical.js` 时，应同步核对精确源码、许可与修改说明。MPL-2.0 的适用范围见其许可原文。
