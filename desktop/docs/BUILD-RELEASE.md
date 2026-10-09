# 复现桌面发行资源

本目录构建依赖需要Node24/npm。使用npm ci，随后npm run check、npm test。backend以c319/1.0.1为基线，前端文案在1.0.3更新，后端和依赖仍为原字节；backend/node_modules内两项最小依赖也属于必要源码输入，不能与顶层构建依赖一起删除。其48文件哈希和官方registry integrity见backend/dependency-manifest.json。运行包不包含用户数据。

## Windows单ZIP

```sh
npm run package:win:zip
node scripts/verify-packaged.cjs dist/win-unpacked/Qingdan.exe dist/win-unpacked/resources/app.asar windows-asar.json
python3 scripts/finalize-windows-zip.py dist/Qingdan-1.0.3-win-x64.zip dist/releases/青单-1.0.3-windows-x64.zip docs/WINDOWS-START-HERE.txt
python3 scripts/verify-windows-zip.py dist/releases/青单-1.0.3-windows-x64.zip dist/win-unpacked windows-zip.json --readme docs/WINDOWS-START-HERE.txt
```

finalize拒绝覆盖已有成品，且只添加说明；重新构建请使用新的输出路径。EXE没有本项目发布者签名。验证程序仅解析PE、逐文件字节/哈希和ZIP CRC，不运行Windows程序。

## Linux云端Mac工程DMG

1. npm run package:mac:dir生成arm64 青单.app。afterExtract保留同版本官方Electron许可证；afterPack把四类helper恢复为官方Electron Helper路径，主可执行文件为青单。辅助程序显示名为中文，稳定bundle ID和QingdanDesktop数据目录不变。
2. 准备从crates.io固定源码编译的apple-codesign 0.29.0，及docs/DMG-TOOLCHAIN.md列明的固定Mozilla源码、UTF-8/UTF-16补丁和可信Debian工具链。RCODESIGN、DMG_TOOLROOT必须是自己的已核来源工具绝对路径；不要使用未知来源二进制。这里不提供系统安装、证书创建、签名凭据发现或安全设置修改。
3. 对全部修改完成的独立副本做无身份/无时间戳ad-hoc签名，再生成DMG：

```sh
mkdir -p dist/engineering dist/releases
node scripts/sign-mac-engineering.cjs --rcodesign "$RCODESIGN" --input "$PWD/dist/mac-arm64/青单.app" --output "$PWD/dist/engineering/青单.app"
python3 scripts/mac/inspect-launch.py dist/engineering/青单.app
node scripts/verify-packaged.cjs dist/engineering/青单.app/Contents/MacOS/青单 dist/engineering/青单.app/Contents/Resources/app.asar mac-asar.json
python3 scripts/mac/inspect-bundle.py dist/engineering/青单.app > mac-structure.json
python3 scripts/mac/inspect-resource-seals.py dist/engineering/青单.app mac-structure.json > mac-resource-seals.json
python3 scripts/build-dmg-linux.py --app "$PWD/dist/engineering/青单.app" --output "$PWD/dist/releases/青单-1.0.3-mac-arm64.dmg" --toolroot "$DMG_TOOLROOT" --readme "$PWD/docs/MAC-START-HERE.txt"
```

脚本拒绝覆盖原候选，签名环境只含最小系统变量及显式空signer配置，不读取开发者身份、不上传Apple/公证或时间戳服务。不能把rcodesign或自有Python结构校验叫作Apple/macOS签名验证。

4. 用可信7-Zip读取真正Dmg格式（-tDmg），测试全部CRC，解出3.hfsx并逐字节比较build脚本报告的rawHfs，再用scripts/dmg/inspect-hfs.py比較全部stage文件、UTF-16目录、mode和symlink目标。用7-Zip正常解出最终app，重新运行inspect-launch.py、verify-packaged.cjs及签名/资源核验。不要挂载主机镜像，也不要以同一生成库自解压代替独立证据。

macOS原生构建可用正常Electron打包工具和系统签名/磁盘镜像工具，在真实macOS检查codesign、挂载和启动。Linux结构通过不代表这些原生检查通过。正式Developer ID签名/Apple公证需要另行取得合法身份与授权。

## 冻结版本验证边界

- Electron44.6.0（其utilityProcess实测Node24.21.0、SQLite3.53.4）/electron-builder26.15.3，锁文件冻结
- 独立后端c3194463a8cf748242955c61da72969c652ea062、1.0.1，不替换为未验证HEAD
- 1.0.2桌面82项纯测试通过；当前容器不能创建AF_UNIX socket，未重跑Linux GUI。旧1.0.1的Linux正常sandbox GUI自启、任务、附件、退出/重开证据只作为历史记录
- 三平台同一ASAR资源。Windows/macOS原生运行、Mac原生挂载和Gatekeeper、真实私服HTTPS账号登录仍未验证；不能从Linux外推

## 1.0.2 Mac 启动修复

1.0.1 的 CFBundleName=青单与实际 Qingdan Helper 路径不匹配。Electron 44.6.0 在 JavaScript 启动前先寻找 Electron Helper，找不到再寻找 CFBundleName 对应的辅助程序，原包两者都缺。1.0.2 在 afterPack（签名和 fuse 最终处理之前）把四类辅助程序恢复为官方 Electron Helper 名称、匹配 CFBundleExecutable，显示名称为中文；mac.executableName 固定为青单，使主可执行文件和外层目录都是青单。app.qingdan.desktop 和 QingdanDesktop 数据目录保持稳定，冻结的 c319 后端与 Android 源码不变。

新增 test/mac-bundle.test.cjs 覆盖原错误、四种 helper、中文显示名、缺失/权限/冲突拒绝及稳定配置。scripts/mac/inspect-launch.py 对真实解包 app 按固定版本规则检查辅助程序。该检查不是 macOS 原生运行测试。

## 1.0.3 文案清理

本次仅删去设置页与运行说明中多余的产品比较和声明，没有新增宣传文案。正常重建了在线/离线前端；Mac继续保持1.0.2修复后的helper、中文app和数据目录。用户数据库、后端API及依赖许可证未改。详见RELEASE-1.0.3.md。
