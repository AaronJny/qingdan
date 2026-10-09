# 构建依赖安全审计（2026-10-07）

## 结果

Electron 44.6.0、electron-builder 26.15.3 锁定依赖：npm audit 报告 8 moderate、0 high、0 critical。8 个条目是同一已知 `sprintf-js` advisory 的依赖传播，不是 8 个独立漏洞。

链路：electron-builder → app-builder-lib → @electron/get 3.1.0 → global-agent 3.0.0 → roarr 2.15.4 → sprintf-js 1.1.3。dmg-builder / squirrel-windows 等上层包也因此被 npm 标记。

[GHSA-hp3w-g68c-fv3c / CVE-2026-97058](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)：控制格式字符串的攻击者可给 `%f` / `%e` / `%g` 注入过大的精度，使数字格式化抛出未捕获 RangeError，造成调用方拒绝服务。该 advisory 没有声明 patched version；当前 registry 的 sprintf-js latest 仍是 1.1.3。

## 对本项目的具体影响

- 这些包只列为 devDependencies，没有生产 npm dependencies；v3应用ASAR另打包冻结backend和Temporal/jsbi两个最小运行依赖；sprintf-js构建链不在ASAR中。
- remote renderer 没有 Node/preload，无法 require 此构建依赖或调用 sprintf。
- 源码包不附顶层构建 node_modules；desktop/backend/node_modules仅保留两个运行必需最小依赖，未包含本advisory构建链。用户重建时 `npm ci` 会安装这个已披露工具链。
- 逐行检查当前 global-agent 日志调用：格式文本是该包源码中的固定消息；网络 URL、代理设置与错误作为 context data 传给 logger，没有发现远程值直接成为 sprintf 格式字符串的路径。这是本版本代码审计结果，不是对所有未来版本的安全保证。
- roarr 在 `ROARR_LOG` 未启用时使用 mock logger。本构建脚本进一步在子进程设置 `ROARR_LOG=false`，保持对应 formatter 路径不活跃。不要为构建盲目打开第三方 proxy trace 日志。
- 预期剩余风险是工具链被自定义日志/未来变化暴露后造成构建失败；该 advisory 不说明代码执行、凭据窃取或应用 renderer 被远程接管。

## 应对

1. 保留已验证的版本和 package-lock，不盲目执行 `npm audit fix --force`。本次 npm 的 fix suggestion 指向旧 electron-builder 26.5.0，不作为安全升级结论。
2. 构建中禁用 ROARR_LOG；不用未经审核的插件/脚本把用户输入交给 formatter。
3. 打包后检查 ASAR 只含应用源码和资源，不含 devDependencies。
4. 正式发布前再次 audit；维护者给出修复后单独升级和回归全部打包/登录测试。
5. 这份剩余工具链告警随源码交付披露，不声称依赖审计「零漏洞」。

## v3沿用范围

本记录为2026-10-07对相同Electron44.6.0/electron-builder26.15.3锁定工具链的检查，不声称2026-10-08另作全依赖审计。v3生产ASAR逐文件已核无该构建链。

Linux可选签名工具apple-codesign0.29.0固定locked构建的zip2.2.1涉及RUSTSEC-2025-0168/CVE-2025-29787恶意symlink归档解包告警（2.3修复）；本次只签自己的已生成目录，不提取未知归档、不调用公证/远程签名，该工具及Rust依赖不随应用发布。此为窄路径影响说明，非完整RustSec审计。
