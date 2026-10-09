# 独立服务端发行包构建

发行资源由当前完整检查通过的源码快照生成。以下仅供源码开发/重新打包，发行包用户直接使用根启动入口。

1. 使用 Node.js 24，在应用源码目录执行 `npm ci`、`npm run check`。该命令包含编译，并写入同快照哈希证据。
2. 从仓库根目录执行 `node desktop/scripts/prepare-backend.cjs /path/to/application-source /path/to/fresh-runtime`。共享准备器调用 `prepare-runtime.py` 验证当前源码/资源/检查结果，分析编译服务的外部导入，从应用锁文件提取完整纯JavaScript依赖闭包，执行 `npm ci --omit=dev --ignore-scripts`，并写入逐文件依赖证据。不要直接复制旧desktop/backend、完整开发node_modules或实例数据。
3. 从官方 https://nodejs.org/dist/v24.19.0/ 下载 `SHASUMS256.txt`、`node-v24.19.0-linux-x64.tar.xz`、`node-v24.19.0-darwin-arm64.tar.xz` 到同一个目录。`assemble.py` 对两个归档逐SHA256校验，拒绝其他字节；离线装配不会下载任何内容。
4. 执行 `python3 server-packaging/assemble.py --app /path/to/fresh-runtime --nodes /path/to/node-archives --output /path/to/fresh-server`。
   若已有从这两个官方归档验证过的运行时，可改用 `--verified-runtime /path/to/runtime`；脚本仍核对固定二进制、许可证、字节数和官方归档记录，不接受任意Node文件。两个平台的完整校验成功后才保留输出；失败时清理临时装配目录。应用文件/依赖闭包改变或混入额外文件都会失败。
5. 执行 `python3 server-packaging/zip-release.py /path/to/fresh-server /path/to/new-release.zip`。输出路径必须不存在；ZIP清单与所有文件SHA256一致，并保留脚本/二进制可执行权限。失败时不保留不完整ZIP。
6. 执行 `python3 server-packaging/verify-release.py --zip /path/to/new-release.zip --report /path/to/new-verification.json`。脚本独立解压到包含空格/中文的新临时路径，核对完整清单、源码快照、版本、依赖逐文件证据、两个固定官方Node的二进制/许可证/归档来源和可执行权限，然后仅用包内Node进行合成HTTP复测。复测覆盖内置日历Worker及传递依赖的合成ICS执行、无参/显式/command启动、停启、任务及附件持久性、重复启动拒绝、local/accounts隔离、交互首管理员隐藏密码、账号登录/登出。数据和端口只用于此临时测试，不使用真实凭据或用户数据。
   `--directory /path/to/separately-extracted-server`可检查外部独立解压目录；`--structural-only`明确将HTTP执行报告为未运行，不能据此声称可启动。报告输出路径必须不存在。Mac必须另用arm64实机执行默认复测，不能把Linux结果当作Mac执行成功。
7. 无需下载二进制的包装回归：`python3 -m unittest discover -s server-packaging/tests -v`。合成二进制夹具仅测试验证/拒绝行为，不代表官方Node运行验收。

此源码不包含Node二进制或npm依赖缓存；下载源、固定校验与许可证随运行发行包记录。Node官方支持范围：https://github.com/nodejs/node/blob/v24.19.0/BUILDING.md 。Mac至少13.5/arm64；Linux x64 glibc至少2.28，内核至少4.18。Mac进程宽输出参数参考Apple官方源：https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/ps.1 。不使用或配置发布身份、真实证书或域名。

## 保留的无参数启动修复（2026-10-09）

start.sh在没有用户参数时显式设置默认start操作，再追加原有随机实例标记。这样start.command和直接运行start.sh都能进入启动操作；显式start/stop等参数保持原样。原Node平台选择、instance UUID、owned-PID核对和退出逻辑不变。修复只改start.sh，不改服务器程序、数据库或用户数据。

历史1.0.3服务器ZIP在包含中文和空格的目录独立解压后，26项检查通过：无参start.sh、显式start.sh start、start.command和stop.command（均在Linux执行）正常；HTTP任务创建/修改、附件上传/下载与跨重启持久性通过；重复启动拒绝、模式隔离和实例锁保护保持。测试只使用临时合成数据，不代表macOS原生、真实账号或私服HTTPS验收。

这些历史结果不能代替当前1.1.0成品的重新解压验收；当前结果应以随包验证报告为准。
