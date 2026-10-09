# 青单 Android 0.1.1 发布流水线验证（2026-10-09）

## 当前范围

- 客户端版本0.1.1 / versionCode2；cn.qingdan.android与所有数据库迁移保持不变。独立内置业务代码仍为1.0.1，未宣称等同主应用1.1.1。
- 固定Gradle8.13 / AGP8.12.0 / Platform36 / BuildTools36.0.0，并明确禁用SDK自动下载；不在脚本中接受SDK许可。
- release/debug仍显式未签名。新增签名脚本只引用用户自行配置的四项GitHub Secrets，不生成密钥，不打印秘密，临时私钥不进入成品并在脚本退出时清理。
- 最终APK须通过真实aapt版本/API/launcher检查、apksigner签名与证书检查、zipalign16KiB检查、全部当前源资源逐字节检查、四ABI的SQLite JNI与ELF16KiB检查。验证通过前没有最终发布文件。

## 本地实际完成

- Python验证器与签名环境门禁单元测试25/25通过（包括发布后发现的Groovy版本赋值语法回归门禁）。测试使用合成ZIP/ELF和工具输出字符串，只证明校验逻辑；不把模拟输出当作真实APK或密码学验证。
- bash -n签名脚本语法、Python编译与CLI帮助通过。
- 当前Java21 runtime compiler编译并执行原生安全策略85项、本地存储策略60项通过。此环境没有javac启动器和完整--release17工具链，不把Java21纯JVM运行当作Android构建或跨版本通过。
- 本次本地未执行SDK/Gradle构建、生成签名身份、解码真实密钥、APK签名、设备安装/启动或覆盖升级。用户自行在本机生成并安全配置签名输入；Actions须实际运行并留下成品验收报告。

SDK构建、独立npm ci、当前网页重建、真实签名及成品SHA256以本次Actions任务产物为准。设备/小米14Ultra、真实HTTPS账号和离线恢复仍需单独实测。换证书不能覆盖旧签名版本；卸载会删私有数据，先做完整导出备份。

### 首次发布任务与修复

首次Actions任务37922359500已通过独立npm ci、当前网页构建、Android JS测试7项、原验证器24项以及预装SDK门禁，但Gradle配置阶段因Groovy命令式调用的解析顺序在versionCode处出现Value is null。已改为显式属性赋值versionCode = (...) .toInteger()和versionName = (...)，保留0.1.1/code2。新增回归门禁拒绝重新引入命令式版本赋值；真正SDK构建/签名仍须由修复后的Actions任务重新验证。

---

以下0.1.0记录是历史证据，不作为0.1.1的当前构建/签名通过记录。

# 历史：青单 Android 0.1.0 源码验证（2026-10-09）

## 本次范围与结果

- 仅删除界面中的外部产品指向与比较说明，保留青单名称和已有功能；唯一业务源码改动为 webapp/app/workspace-dialogs.tsx。
- 当前该文件 SHA256：467c10cf0a629fccee3033bb8a683fb5e581baaff8c3d819a2367d526f295e0d。
- 使用现有 scripts/build-web.mjs 完成 TypeScript 检查和 Android Vite 构建。两次标准构建的 19 个内置资产全部逐字节一致，其中网页资源 11 个。资源逐项哈希见 artifacts/BUNDLED-ASSETS.json。
- Android 专用 JS 测试 7/7；原业务纯测试 395/395；Node 服务端测试 3/3。
- React 界面首轮 105/106，通过项与失败原始日志均保留。失败项为完整备份恢复后临时标记清理的异步断言；未改源码或测试，定向复跑 1/1、随后完整复跑 106/106 通过。此为观察到的一次非稳定失败，不将其抹除或归因于已证明的原因。
- 原生宿主安全策略 85 项、本地存储策略 60 项通过，使用当前 Java 21 runtime compiler module 编译并运行。环境没有 javac 启动程序与跨版本 ct.sym，--release 17 初次尝试失败；后续纯 JVM 测试使用当前 Java 21 编译，不代表 Android SDK 构建或 Java 17 跨版本验证。
- 扫描交付目录的源代码、说明与预生成资产，外部品牌字样 0 命中；第三方依赖的正常许可证和 API 标识保留。
- 包名 cn.qingdan.android、Android 版本 0.1.0 / versionCode 1、本地与服务器数据身份、原生宿主和数据库迁移文件保持原字节；6 个迁移文件与来源逐字节相同；所有许可证与依赖版本表保持原字节。
- 构建依赖临时复用 application 的已安装 node_modules，两个 package-lock.json 的 SHA256 均为 5164278c6805e8ce818e580c2200d28eb0b752190c5c703267556035347a9556。未声称本次独立 npm ci。交付目录已移除临时依赖链接、重复 dist 与测试构建产物。
- Vite 提示大于 500 kB 的既有主包与无效动态分包警告；构建成功，没有为此扩大修改范围。

## 本次未运行与限制

本次只交付源码和预生成网页资源，没有新 APK、没有 APK 签名、没有新签名密钥。旧签名私钥当前不可用，不能承诺覆盖升级。未执行 Android SDK/Gradle 构建、SQLite bundled JVM 引擎复验、Android 模拟器或真机安装运行、HTTPS 私服端到端验证。下方及 verification/ 内带旧 APK、SDK、独立解压重建的记录均为历史基准，不能当成本次验证。

当前完整文件哈希以 ANDROID-SOURCE-MANIFEST.json 为准。webapp/SOURCE-MANIFEST.json 与 webapp/tests/standalone-evidence.json 保留的是历史基准，不是当前独立 Android 目录的权威清单。

## 历史基准验证（本次未重跑的部分不算本次通过）

### 旧版本记录的通过项

- 原业务纯测试395项、React界面106项、原Node服务端3项。
- Android专用JS适配与本地业务分发7项，包含原SQLite迁移、独立local身份、任务新增/重复原操作/完成、账号与CSRF拒绝、中段批事务回滚、multipart附件字节、丢失响应回执与完整备份。
- 原生宿主安全策略85项；本地存储策略60项。
- 官方 AndroidX sqlite-bundled 2.6.2 的真实Linux/JVM SQLite3.50.1验证30项：JSON、WAL、synchronous FULL、原迁移、参数类型、批事务回滚、changes()、RETURNING、重启持久化与完整性。
- 使用真实Android SDK36公开API编译；Gradle8.13/AGP8.12.0 release构建、debug和instrumentation APK构建已完成。没有自动生成调试签名密钥。
- 正式交付候选使用明确授权的本应用专用3072-bit RSA证书签名；APK v2/v3签名及16KiB zipalign验证通过（API26起支持；未使用v1签名）。
- minSDK26、target/compileSDK36，包含arm64-v8a、armeabi-v7a、x86、x86_64四ABI，官方SQLite JNI ELF LOAD对齐16KiB。
- Apache2.0全文及第三方说明随源码和APK资产保留；实际打包的49个网页依赖都附完整许可证与版本表。没有账号、用户数据、私服地址、私钥或口令打包。

新增：已从统一源码ZIP独立解压、全新 npm ci --ignore-scripts 安装121个包（没有借用现有依赖），Android JS测试7/7通过，重新编译的11个网页资产全部逐字节一致。此项只验证源码/网页构建可复现，不等同Android运行。

### 仍需实际设备核对

- 未接入用户手机，因此小米14Ultra原生安装、运行、输入法、系统文件选择器、通知权限与省电限制尚未真机验证。
- 云环境没有VMX/SVM加速。API36软件模拟器进入内核后，在2GiB与1GiB单实例尝试中均收到SIGKILL(exit -9，原因未确认)，未完成系统启动；本次不再继续相同环境重试；不将构建成功或JVM检查称作Android系统运行通过。
- Android原生文件系统instrumentation已编译并准备4个测试，只有系统实际运行后才能列为通过。
- 本次没有真实HTTPS私服账号、TLS会话或真机断网恢复实测；对应实现已做输入/域/会话隔离及失败处理，仍需端到端确认。
- 通知仅支持前台核对后的系统通知；未实现后台推送/后台轮询/准点闹钟，不保证小米省电下必达。
- 需较新的系统Android WebView（支持现代ES2022/React19网页特性）。Android系统最低API26本身不保证未更新的WebView可用。

### 两种测试不可混同

Node SQLite桥合成对照只验证复用JS业务和适配协议。官方bundled SQLite的JVM测试验证真实SQL引擎。Android应用启动和Android私有文件操作需模拟器/真机测试；三者分别记录。

原交付 APK 的签名私钥当前不可用。本次没有创建任何替代签名身份，没有生成或签名 APK，也没有验证覆盖升级。不同证书不能直接覆盖原安装；不要为解决签名冲突直接卸载已有应用，卸载会删除应用私有数据。
