# Ubuntu 24.04 安装包与验收

## 修复范围与状态

Ubuntu 24.04 的 AppArmor 默认限制未授权应用创建 user namespace。旧版 AppImage 的挂载/解压路径不固定，不能直接套用固定可执行文件策略。把构建 runner 换为 Ubuntu 22 仅绕过构建机上的触发条件，不解决 Ubuntu 24 用户安装。

新增 `npm run package:linux:deb`，生成 `dist/Qingdan-版本-linux-amd64.deb`。它从已验证的 `linux-unpacked` 独立装配，不使用 electron-builder/FPM 的安装脚本，不改写 AppImage 输入。原 AppImage 发布流程保持原状；本次不改版本、发布请求、下载链接或已发布文件。

**新包仍是候选修复。只有手动 Ubuntu 24 验收成功后，才能称为已验证支持，或把 `.deb` 接入正式发布。** 本地包结构测试和模拟维护脚本不等于实际安装或内核策略验收。

## 安装行为与安全边界

- 程序固定安装在 root 所有、普通用户不可写的 `/opt/Qingdan`，命令为 `/usr/bin/qingdan`，菜单入口为 `qingdan.desktop`。
- `/etc/apparmor.d/app.qingdan.desktop` 只匹配 `/opt/Qingdan/qingdan`。`flags=(unconfined)` 是 Ubuntu 的 userns 兼容模式，并非额外的完整应用访问控制；它仅为这条固定可执行文件路径明确允许 user namespace，让 Chromium 建立自己的渲染进程沙箱。
- **安装会加载上述应用级安全策略，需要管理员明确同意。** 不修改全局 sysctl/AppArmor 设置，不关闭 Electron 沙箱，不设置 `chrome-sandbox` 的 4755 权限。包要求 AppArmor 4，因此不把该 `.deb` 宣称为 Ubuntu 22 安装包。
- 安装脚本直接重新编译策略，不主动写入 AppArmor 二进制缓存。系统 AppArmor 服务以后可能生成自身缓存；purge 不清理系统缓存，也不将缓存残留当作策略仍在运行。
- 策略是 dpkg conffile，升级保留管理员修改；真正的策略加载失败会导致安装配置失败，不静默降级。
- 卸载只卸载本包命名策略。升级、回滚阶段不卸载新策略。remove 后 conffile 遵循 Debian 规则保留，purge 移除；所有阶段均不删除用户目录 `QingdanDesktop`。
- 若系统已禁用 AppArmor，不擅自启用它；此时该策略不加载，也不能声称已验证 Ubuntu 24 默认限制情形。若处于容器/chroot、没有内核策略权限，安装配置应明确失败，不能把它当作正常桌面测试。

管理员确认后，在真实 Ubuntu 24.04 x86-64 图形桌面可用 apt 安装或升级候选包：

```sh
sudo apt install ./Qingdan-版本-linux-amd64.deb
qingdan
```

退出应用并备份 `${XDG_CONFIG_HOME:-~/.config}/QingdanDesktop` 后再升级。卸载 `sudo apt remove qingdan`；连同包配置清理使用 `sudo apt purge qingdan`，两者均保留用户业务数据。MCP 命令可稳定使用 `/usr/bin/qingdan --mcp`，授权设置仍由用户在应用内完成。

## 可重复验证

工作流 `Ubuntu 24 installed package validation` 不发布任何内容。专用测试分支 `fix/ubuntu24-install` 的推送须事先得到安装/卸载 Qingdan 专用 AppArmor 策略的明确批准；本次已获批准。其他分支只接受手动触发，执行者须明确勾选允许在一次性 runner 安装/卸载该策略。它要求 Ubuntu 24.04、AppArmor 启用、`apparmor_restrict_unprivileged_userns=1`，条件不符即失败，不修改全局策略以迁就测试。

验收内容：

1. 完整源码检查，构建并独立解出 `.deb`，比对程序、维护脚本、策略及控制文件，核验 root 所有权、不可被组/其他用户写入、无 setuid/setgid 文件。
2. 实际 apt 安装合成基线包 `0.0.0`，再升级到候选包、重装、remove 和 purge。基线使用同一程序 payload，证明 dpkg 升级生命周期和用户文件保留，**不代表历史应用数据迁移测试**。
3. 普通用户从固定已安装路径启动真实 GUI，核验可见 X11 窗口和内核渲染沙箱证据。仅表示窗口启动，不等于完整 GUI 操作、Wayland、真实设备通知等端到端验收。
4. 普通用户运行已安装程序的 MCP stdio 检查，使用临时合成数据和回环 gateway，不创建真实用户授权。
5. 卸载后验证策略、命令和菜单清理及全局 userns 限制未变；保存独立 GUI、MCP、生命周期报告。

资料：
- Ubuntu 24.04 user namespace 限制：https://discourse.ubuntu.com/t/ubuntu-24-04-lts-noble-numbat-release-notes/39890
- AppArmor user namespace 设计：https://discourse.ubuntu.com/t/spec-unprivileged-user-namespace-restrictions-via-apparmor-in-ubuntu-23-10/37626
