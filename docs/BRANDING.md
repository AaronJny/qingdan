# 青单图标资源

青单使用绿色剪贴板标识，网页、桌面和 Android 使用统一的绿色、浅绿、米白配色。

## 资源位置

- 桌面 PNG、ICO、ICNS：`desktop/build/`
- 网页 favicon 与应用内标识：`application/public/favicon.svg`
- Android 网页标识：`android/webapp/public/favicon.svg`
- Android 启动图标：`android/android/app/src/main/res/drawable/ic_qingdan.xml`
- 网页 manifest 主题色：`#276455`

登录页与功能栏引用 favicon；功能图标使用 `lucide-react`，习惯预设使用系统 emoji。

## 更新检查

修改标识时，同步更新以上资源并运行 `npm run check --prefix desktop`。重新构建网页与安装包，检查浅色、深色主题下的显示效果。应用包名和用户数据目录与图标资源分开维护。
