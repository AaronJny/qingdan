# 青单图标

青单沿用 `desktop/build/icon.png` 的绿色剪贴板标识。桌面 PNG、ICO、ICNS 保留不变；网页 favicon 与应用内标识、Android 启动图标使用相同的绿色、浅绿、米白配色和剪贴板图形。

- 网页与离线壳：`application/public/favicon.svg`
- Android 网页副本：`android/webapp/public/favicon.svg`
- Android 原生：`android/android/app/src/main/res/drawable/ic_qingdan.xml`
- 两份网页 manifest 的主题色：`#276455`

登录页、功能栏和 Android 关于页直接使用 favicon 资源，避免单独维护一个蓝底白勾标识。功能栏原来的返回“今天”操作保留。其余功能图标继续使用 `lucide-react`，习惯预设继续使用系统 emoji。

未被源码引用的 `file.svg`、`globe.svg`、`window.svg` 初始模板资源已移除。历史构建证据中仍可能记录这些旧文件；新构建从当前源码重新生成。

`npm run check --prefix desktop` 包含跨端品牌资源回归检查。更改图标时应同步核对以上资源，不改包名或用户数据目录。
