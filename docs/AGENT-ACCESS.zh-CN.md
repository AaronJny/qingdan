# 将 Agent 连接到青单

[English](AGENT-ACCESS.md) · [简体中文](AGENT-ACCESS.zh-CN.md)

青单桌面客户端可以让支持 MCP 的 Agent 访问指定清单中的任务。统一通过本地桌面客户端中转，既支持内置本地数据，也支持桌面客户端当前登录的私有服务器账户。不需要配置对外开放的远程 HTTP MCP 服务。

Agent 访问从 v1.3.7 开始提供。使用前，请同时更新桌面客户端和所连接的私有服务器。

## 开始之前

- 使用包含“设置 → Agent 访问”的青单桌面构建，以及能够启动本地 stdio 进程的 MCP 客户端。
- 保持青单运行。使用私服时，先在青单中正常连接并登录。Agent 不会获得你的密码、浏览器 Cookie 或 CSRF 令牌。
- 更新后的桌面安装包可通过已安装的青单程序加 `--mcp` 参数运行适配器，无须另装 Node.js。设置面板会显示可执行文件路径。源码运行方式见下文。
- 默认关闭访问。打开设置不会授权。首版不支持 Android 本地数据访问、仅浏览器承载 MCP，或云端 Agent 直接连接你的电脑。

## 明确授权

1. 在青单桌面窗口打开“设置 → Agent 访问”。
2. 核对显示的服务器和账户，逐个选择允许访问的清单。不存在“自动授权所有未来清单”的选项。
3. 保持“允许修改任务”关闭即可只读访问。仅在需要 Agent 创建、编辑或完成任务时开启。
4. 核对范围并勾选确认框，然后点击“启用 Agent 访问”。
5. macOS/Linux 会生成仅当前系统用户可访问的本机凭据文件，配置只需引用其路径，无须复制令牌。Windows 使用下文的一次性令牌备用方式。每次授权或更新授权后，请重启 MCP 客户端。

只读访问包括清单名称，以及任务标题、描述和受支持的任务字段，不包含评论、附件、成员详情或历史记录。写入当前支持创建任务、修改受支持字段及完成任务，不提供任意管理操作、文件访问、删除任务或迁移清单。完成父任务可能同时完成子任务；完成重复任务可能生成下一次实例。原有账户及清单权限始终生效。

## 配置 MCP 客户端

请先在设置面板中选择 Codex 或 OpenCode，再复制对应配置。二者格式不同，不应使用通用的 mcpServers JSON。Codex：将 TOML 合并到 `~/.codex/config.toml`，已有 `[mcp_servers.qingdan]` 时更新该条目。OpenCode：将 `qingdan` 合并到现有 `opencode.json` 或 `opencode.jsonc` 的 `mcp` 对象中。不要覆盖其他设置，完成后重启客户端。格式依据：[Codex 官方 MCP 配置](https://developers.openai.com/codex/mcp)、[OpenCode 稳定版 MCP 文档](https://opencode.ai/docs/mcp-servers/)。

macOS/Linux 请复制设置面板中的配置。凭据文件路径绑定到确切的服务器和账户，不会指向之后任意打开的账户。

#### Codex · config.toml

```toml
[mcp_servers.qingdan]
command = "<Qingdan-executable-path-from-settings>"
args = ["--mcp"]

[mcp_servers.qingdan.env]
QINGDAN_AGENT_DESCRIPTOR = "<private-credential-file-path-from-settings>"
```

#### OpenCode · opencode.json / opencode.jsonc

```json
{
  "mcp": {
    "qingdan": {
      "type": "local",
      "command": [
        "<Qingdan-executable-path-from-settings>",
        "--mcp"
      ],
      "environment": {
        "QINGDAN_AGENT_DESCRIPTOR": "<private-credential-file-path-from-settings>"
      },
      "enabled": true
    }
  }
}
```

私密文件包含当前回环地址和令牌，仅在你明确启用访问后创建，撤销访问或正常退出时删除。非正常退出可能留下过期文件，但该文件无法恢复已失效的授权。重新授权同一服务器和账户会恢复相同路径，无须每次修改配置。但仍须重启 MCP 进程：适配器只读取文件一次，已撤销的进程不会自动采用新授权。其他服务器或账户使用不同路径。

请保护此文件，不要上传、提交到源码仓库或分享其内容。使用青单显示的准确程序路径和凭据路径。macOS 的命令指向应用包内部的可执行文件，而非 `.app` 文件夹；Windows 指向 `Qingdan.exe`。`--mcp` 进程仅运行 stdio 适配器，不会再打开图形窗口，但仍需要已经运行的桌面中转服务。

### Windows 备用方式

首版尚未验证 Windows 凭据文件的 ACL，因此使用明确的环境变量配置：

#### Codex · config.toml

```toml
[mcp_servers.qingdan]
command = "C:\\path\\to\\Qingdan.exe"
args = ["--mcp"]

[mcp_servers.qingdan.env]
QINGDAN_AGENT_ENDPOINT = "http://127.0.0.1:<port-from-settings>/tools"
QINGDAN_AGENT_TOKEN = "<your-one-time-token>"
```

#### OpenCode · opencode.json / opencode.jsonc

```json
{
  "mcp": {
    "qingdan": {
      "type": "local",
      "command": [
        "C:\\path\\to\\Qingdan.exe",
        "--mcp"
      ],
      "environment": {
        "QINGDAN_AGENT_ENDPOINT": "http://127.0.0.1:<port-from-settings>/tools",
        "QINGDAN_AGENT_TOKEN": "<your-one-time-token>"
      },
      "enabled": true
    }
  }
}
```

将仅显示一次的令牌复制到 MCP 客户端私密配置中，优先使用客户端的安全凭据功能。然后点击“清除令牌”并清除剪贴板。关闭面板也会移除显示的令牌，青单不会再次展示它。切勿放入网址、命令行参数、聊天或截图中。使用设置面板显示的回环地址，不要替换为私有服务器的网址。重启青单后须更新地址和令牌，更新授权后须更新令牌。

可以先让 Agent 列出允许访问的清单或查找未完成任务，核对账户与清单后再请求修改。写入结果不确定时，Agent 应沿用同一操作 ID 重试；版本冲突时应重新读取任务，而不是静默覆盖后续编辑。

### 从源码运行

未打包的源码环境需要 Node.js 24。在 `application` 目录执行 `npm ci` 和 `npm run build`。Codex 的 `command` 使用 `node`（或其绝对路径），`args` 使用 `["/absolute/path/to/qingdan/application/dist/server/mcp.mjs"]`。OpenCode 的 `command` 数组使用 `["node", "/absolute/path/to/qingdan/application/dist/server/mcp.mjs"]`。分别保留 `env` 或 `environment` 中的凭据文件变量或 Windows 备用变量。直接运行 Node，不要使用 `npm run`，避免包管理器输出干扰 MCP 的 stdio 通道。没有打包启动器时，设置面板显示源码路径占位符。

## 修改或撤销授权

- 修改所选清单或读写权限后，重新核对并点击“应用权限并更新授权”。旧凭据立即失效，请重启 MCP 客户端；Windows 还须更新令牌配置。
- 点击“撤销 Agent 访问”可立即停止访问，无须再次勾选确认框。
- 授权仅对本次桌面会话有效。退出或重启青单、退出登录、切换服务器后，须重新打开设置、核对目标并授权，然后重启 MCP 客户端。同一目标保留原凭据文件路径；Windows 需更新地址和令牌。
- 授权绑定到已验证的服务器和账户，不会静默跟随新账户或服务器。断线或登录失效时请求会失败，不会暂存写入等待以后执行。

如果设置更改结果不确定，请重新打开面板核对当前状态，再决定是否更新授权。连接失败时，请检查青单是否仍在运行、服务器和账户是否正确登录、私服是否支持此功能，以及配置的凭据文件（或 Windows 的地址与令牌）是否属于当前授权。不要通过向局域网或公网开放中转端口来绕过问题。
