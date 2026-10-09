# Android 发布签名设置

签名密钥只在自己的电脑生成和备份，不应发到聊天、提交到仓库或上传为构建产物。当前旧 APK 的私钥不可用。新密钥签名的应用无法覆盖安装旧签名版本；已有应用先在应用内导出完整备份，再按需卸载、安装和导入。卸载会删除应用私有数据。

## 在自己的 Mac 生成一次

需要官方 JDK 的 `keytool`。将此仓库检出到自己的电脑，选一个已经存在的私密备份目录，执行：

```sh
bash android/scripts/create-release-key-macos.sh "$HOME/你的私密备份目录/qingdan-release.p12"
```

脚本拒绝覆盖已有文件。`keytool` 会隐藏输入地询问新密码两次，生成 PKCS12/RSA3072 密钥，别名固定为 `qingdan`。将密码保存在自己的密码管理器，并另行安全备份 `.p12`。PKCS12 的密钥密码与容器密码相同。

最后脚本征得确认后会把密钥的 Base64 内容复制到 Mac 剪贴板，不把内容打印到终端。只粘贴进下面的 GitHub 密钥表单；完成后清空剪贴板，例如 `printf '' | pbcopy`。

## 在 GitHub 配置一次

打开此仓库的 Settings → Secrets and variables → Actions → New repository secret，逐个创建：

- `ANDROID_KEYSTORE_BASE64`：脚本复制到剪贴板的内容
- `ANDROID_KEYSTORE_PASSWORD`：刚才选择的密码
- `ANDROID_KEY_ALIAS`：`qingdan`
- `ANDROID_KEY_PASSWORD`：同一个密码

密钥、密码和 Base64 都不要发到聊天或写进源码。此配置授权本仓库发布工作流在后续 Android 构建中使用同一身份签名。GitHub 加密存储 secrets；有写权限的人可修改工作流，应仅给可信人员仓库写权限。

## 发布

配置完成后，在 Actions 中选择“青单发布”→ Run workflow，分支选 main。也可重跑缺少签名而失败的 Android job。默认只会在专门更新 `.github/release/request.json`、推送版本 tag 或手动运行时构建发布，不会为每个普通代码提交发布。

工作流只在 runner 临时目录解码密钥，密码通过环境变量交给 `apksigner`，不打印秘密，不把密钥收进 APK 或 artifact，并在结束时清理临时密钥。只有通过 APK 签名、版本、资源和原生库检查的成品才进入 Release；不会发布不可安装的 unsigned APK。

Android 独立客户端版本为 0.1.1，内置业务代码基准为 1.0.1。它不是桌面/服务器 1.1.1 的等同实现，也不宣称完成真机测试。
