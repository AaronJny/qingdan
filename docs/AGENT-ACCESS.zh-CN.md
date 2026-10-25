# 将 Agent 连接到青单

[English](AGENT-ACCESS.md) · [简体中文](AGENT-ACCESS.zh-CN.md)

## 可以做什么

让支持 MCP 的 Agent 在你选定的清单中查找、创建、编辑和完成任务。既可使用本地数据，也可使用青单当前登录的私服账户。访问默认关闭，是否允许修改任务由你单独决定。

## 开始之前

- 使用 v1.3.8 或更新版本的青单桌面客户端；使用私服时，也请更新私服。
- Agent 需要支持本地 stdio MCP 连接，并与青单运行在同一台电脑上。
- 保持青单运行并登录。使用桌面安装包无须另装 Node.js。
- 这种连接方式不支持 Android、仅浏览器使用，或运行在另一台电脑上的 Agent。

## 五步连接

1. 在青单中打开“设置 → Agent 访问”。
2. 核对服务器和账户，选择允许 Agent 访问的清单。
3. 保持“允许修改任务”关闭即可只读访问；需要创建、编辑或完成任务时再开启。
4. 核对权限，勾选确认框，然后点击“启用 Agent 访问”。
5. 将显示的连接信息填写到 MCP 客户端中，然后重启客户端。

默认“通用本地 stdio”视图显示 `command`、`args` 和 `env`。它们是连接信息，并不是所有客户端都能直接导入的配置文件：

```json
{
  "command": "<Qingdan-executable-path-from-settings>",
  "args": ["--mcp"],
  "env": {
    "QINGDAN_AGENT_DESCRIPTOR": "<private-connection-file-path-from-settings>"
  }
}
```

- `command`：设置中显示的青单可执行文件。
- `args`：传给该程序的参数。
- `env`：启动该程序时使用的环境变量。

请按所用客户端的格式填写，并使用青单显示的路径，不要填写私服网址。macOS 的可执行文件位于 `.app` 文件夹内部。请妥善保管私密连接文件，不要分享其内容。

### Windows

使用显示的程序路径和 `args: ["--mcp"]`。在 `env` 中按设置面板填写 `QINGDAN_AGENT_ENDPOINT`、`QINGDAN_AGENT_TOKEN`，并将 `ELECTRON_NO_ATTACH_CONSOLE` 设为 `"1"`。令牌占位符需要由你私下替换为青单仅显示一次的令牌。

优先使用客户端的安全凭据保存功能。保存后点击“清除令牌”，并清除剪贴板。不要在聊天或截图中分享令牌。重启青单后需要更新地址和令牌；更新权限后需要更换令牌。

## 可选客户端模板

Codex 和 OpenCode 只是可选的配置格式模板，并不限制可使用的 MCP 客户端。复制设置面板显示的模板时，请保留客户端的其他配置。

<details>
<summary>Codex</summary>

将条目合并到 `~/.codex/config.toml`。已有 `qingdan` 条目时更新它，不要重复添加。

```toml
[mcp_servers.qingdan]
command = "<Qingdan-executable-path-from-settings>"
args = ["--mcp"]

[mcp_servers.qingdan.env]
QINGDAN_AGENT_DESCRIPTOR = "<private-connection-file-path-from-settings>"
```

Windows 请改用青单显示的环境变量，而非 `QINGDAN_AGENT_DESCRIPTOR`。

[Codex 配置帮助](https://developers.openai.com/codex/mcp)

</details>

<details>
<summary>OpenCode</summary>

将 `qingdan` 合并到现有 `opencode.json` 或 `opencode.jsonc` 的 `mcp` 部分。

```json
{
  "mcp": {
    "qingdan": {
      "type": "local",
      "command": ["<Qingdan-executable-path-from-settings>", "--mcp"],
      "environment": {
        "QINGDAN_AGENT_DESCRIPTOR": "<private-connection-file-path-from-settings>"
      },
      "enabled": true
    }
  }
}
```

Windows 请改用青单显示的环境变量，而非 `QINGDAN_AGENT_DESCRIPTOR`。

[OpenCode 配置帮助](https://opencode.ai/docs/mcp-servers/)

</details>

可以先让 Agent 列出允许访问的清单或查找未完成任务，核对账户与清单后再请求修改。

## 权限与重新连接

- 只读访问包括清单名称和任务详情，不包含评论、附件、成员或历史记录。原有账户和清单权限仍然生效。
- 写入权限支持创建、编辑和完成任务，不支持删除任务或管理账户。完成父任务可能同时完成子任务；完成重复任务可能生成下一次任务。
- 新清单不会自动获得授权。调整范围时，选择清单和权限，重新核对后点击“应用权限并更新授权”，然后重启 MCP 客户端。
- 点击“撤销 Agent 访问”可立即停止访问。
- 退出青单、退出登录或切换服务器后，访问会失效。请重新打开设置，核对账户并启用访问，然后重启 MCP 客户端。授权不会悄悄切换到另一个账户。
- macOS/Linux 下，同一账户和服务器的连接文件路径保持不变。Windows 请按上文更新地址和令牌。

## 常见问题

连接失败时，请检查青单是否正在运行、正确账户是否已登录、青单与私服是否均已更新，以及客户端是否使用当前连接信息。不要把连接端口开放到互联网。

任务修改失败或结果不确定时，请先核对任务，再决定是否重试。

Linux 需要系统支持 Electron 沙箱。Ubuntu 24.04 可能阻止此版本的 AppImage 启动，解压后也可能如此。请勿通过关闭沙箱绕过限制；此版本尚未解决该系统限制。
