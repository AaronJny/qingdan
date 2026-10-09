# 独立服务端发行包构建

发行资源由当前完整检查通过的源码快照生成。以下仅供源码开发/重新打包，发行包用户直接使用根启动入口。

1. 使用 Node.js 24，在应用源码目录执行 `npm ci`、`npm run check`。该命令包含编译，并写入同快照哈希证据。
2. 用 Python 3 执行 `python3 prepare-runtime.py /path/to/application-source /path/to/fresh-runtime`。脚本校验源码与生成资源的完整哈希、检查结果和当前版本，再复制编译文件与迁移/依赖清单。
3. 在 fresh-runtime 目录执行 `npm ci --omit=dev`，建立锁定的生产依赖；不复制实例数据。
4. 从官方 https://nodejs.org/dist/v24.19.0/ 下载 `SHASUMS256.txt`、`node-v24.19.0-linux-x64.tar.xz`、`node-v24.19.0-darwin-arm64.tar.xz` 到同一个目录。`assemble.py` 将对两个归档逐SHA256校验，拒绝其他字节。
5. 执行 `python3 assemble.py --app /path/to/fresh-runtime --nodes /path/to/node-archives --output /path/to/fresh-server`。
   若已有从这两个官方归档验证过的运行时，可改用 `--verified-runtime /path/to/runtime`；脚本仍核对固定二进制、许可证和官方归档哈希，不接受任意 Node 文件。
6. 执行 `python3 zip-release.py /path/to/fresh-server /path/to/new-release.zip`。输出路径必须不存在；保留脚本/二进制可执行权限。
7. 最终应从该ZIP另解到包含空格/中文的新路径，用内置运行时检查启动/停启、数据持久性、local/accounts隔离及交互管理员初始化。Mac必须另用实机验收，不能把Linux测试当作Mac执行成功。

此源码不包含Node二进制或npm依赖缓存；下载源、固定校验与许可证随运行发行包记录。Node官方支持范围：https://github.com/nodejs/node/blob/v24.19.0/BUILDING.md 。Mac至少13.5/arm64；Linux x64 glibc至少2.28，内核至少4.18。Mac进程宽输出参数参考Apple官方源：https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/ps.1 。不使用或配置发布身份、真实证书或域名。

## 保留的无参数启动修复（2026-10-09）

start.sh在没有用户参数时显式设置默认start操作，再追加原有随机实例标记。这样start.command和直接运行start.sh都能进入启动操作；显式start/stop等参数保持原样。原Node平台选择、instance UUID、owned-PID核对和退出逻辑不变。修复只改start.sh，不改服务器程序、数据库或用户数据。

历史1.0.3服务器ZIP在包含中文和空格的目录独立解压后，26项检查通过：无参start.sh、显式start.sh start、start.command和stop.command（均在Linux执行）正常；HTTP任务创建/修改、附件上传/下载与跨重启持久性通过；重复启动拒绝、模式隔离和实例锁保护保持。测试只使用临时合成数据，不代表macOS原生、真实账号或私服HTTPS验收。

这些历史结果不能代替当前1.1.0成品的重新解压验收；当前结果应以随包验证报告为准。
