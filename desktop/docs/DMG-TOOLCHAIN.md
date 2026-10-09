# Linux DMG 构建链（1.0.2）

使用 Mozilla 官方 libdmg-hfsplus 的固定 commit ec239599c1f234a4e01ae3fe51214d0c77e5baa3，应用 scripts/dmg/toolchain/unicode-utf8.patch，修复旧工具把 UTF-8 字节直接拓宽为 UTF-16 的错误。补丁只修改两个文件的双向转换；拒绝非法 UTF-8、孤立 UTF-16 surrogate 和超长文件名。

可复现脚本、完整公开来源 URL、输入 SHA256、Debian 签名索引证据及工具 SHA256 都在 scripts/dmg/toolchain/。在可信 Debian 13/GCC14 环境，执行：

```sh
cd scripts/dmg/toolchain
bash rebuild.sh
bash verify-fixture.sh
```

脚本只把官方固定输入下载和解包到自身目录，不执行 Debian maintainer 脚本、不系统安装、不挂载镜像。工具根目录 DMG_TOOLROOT 指向该目录。完整细节见该目录 README.md。构建出的二进制/缓存不装入源码包。

构建真 DMG 前，build-dmg-linux.py 会调用 validate-stage-names.py。它要求名称已经是 HFS+ 的 Unicode 3.2 规范分解形式，并用上游真实 FastUnicodeCompare 排除大小写/忽略字符等价冲突，不自动修改名字。外层青单.app、主可执行文件青单、中文卷名青单均实际保存在 UTF-16 catalog，不使用伪装扩展名或仅显示标签。

addall 显式 clone_link/special-modes=no，避免遍历 framework 链接或额外特殊权限。脚本只在自己新建的 raw HFS 内把 symlink 低权限位还原为 stage 值，不改主机系统权限。

独立 Debian 7-Zip 检查 UDIF CRC，抽取 raw HFS 后和原始镜像逐字节比较；独立 Python HFS catalog/dataFork 检查每个文件哈希、目录权限、symlink 目标和权限。最终正式 app 必须再核一次，不以同一生成库的自解压代替独立证据。

工具补丁验证：31 个 ASan/UBSan codec 用例；真实中文 fixture 17 项、4 个链接的全部内容/权限/目标一致，fsck -fn通过，独立7-Zip解出的分区与原始镜像逐字节一致。完整成品的验证见 MAC-1.0.2-VERIFICATION.md。

签名使用 crates.io 固定 apple-codesign 0.29.0，源码包及 Cargo.lock 哈希见 BUILD-TOOLS.json，Rust 1.85.1 官方组件来源及哈希见 SIGNING-TOOLCHAIN.json。可在隔离目录安装固定工具后用 cargo install apple-codesign --version 0.29.0 --locked --root <工具目录> 重建；不要把未知来源二进制当成可信工具。使用 scripts/sign-mac-engineering.cjs 做最终无身份、无时间戳的 ad-hoc封印。

这些检查不能替代 macOS 原生挂载、Finder 拖拽、codesign、Gatekeeper 或启动测试。没有 Developer ID/Apple公证，不改变系统安全设置。
