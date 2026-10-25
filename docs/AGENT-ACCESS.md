# Connect an agent to Qingdan

[English](AGENT-ACCESS.md) · [简体中文](AGENT-ACCESS.zh-CN.md)

## What you can do

Let an MCP-compatible agent find, create, edit and complete tasks in the lists you choose. It works with local data or the private-server account signed in to Qingdan. Access is off by default; allowing changes is a separate choice.

## Before you start

- Use Qingdan desktop v1.3.8 or later. Update your private server too, if you use one.
- Your agent must support local stdio MCP connections and run on the same computer as Qingdan.
- Keep Qingdan open and signed in. No separate Node.js installation is needed for the packaged desktop app.
- Android, browser-only use and agents running on another computer are not supported by this connection method.

## Connect in five steps

1. Open **Settings → Agent access** in Qingdan.
2. Check the server and account, then select the lists your agent may access.
3. Leave **Allow task changes** off for read-only access. Turn it on only for creating, editing or completing tasks.
4. Review the permissions, check the confirmation box and click **Enable agent access**.
5. Add the displayed connection details to your MCP client, then restart the client.

The default **Generic local stdio** view shows `command`, `args` and `env`. These are connection details, not a configuration file that every client can import:

```json
{
  "command": "<Qingdan-executable-path-from-settings>",
  "args": ["--mcp"],
  "env": {
    "QINGDAN_AGENT_DESCRIPTOR": "<private-connection-file-path-from-settings>"
  }
}
```

- `command`: the Qingdan executable shown in settings.
- `args`: the arguments passed to that executable.
- `env`: environment variables for that process.

Enter them using your client's setup format. Use the paths shown in Qingdan, not your private server URL. On macOS, the executable is inside the `.app` folder. Keep the private connection file confidential.

### Windows

Use the displayed executable and `args: ["--mcp"]`. In `env`, copy the displayed `QINGDAN_AGENT_ENDPOINT`, supply `QINGDAN_AGENT_TOKEN`, and set `ELECTRON_NO_ATTACH_CONSOLE` to `"1"`. Replace the token placeholder privately with the token displayed once by Qingdan.

Prefer your client's secure secret storage if available. After saving it, choose **Clear token** and clear your clipboard. Do not share the token in messages or screenshots. Restarting Qingdan requires updating both the address and token; renewing permissions requires a new token.

## Optional client templates

Codex and OpenCode are optional formatting templates, not a restriction on which MCP clients you can use. Copy the template shown in settings and preserve your client's other configuration.

<details>
<summary>Codex</summary>

Merge the entry into `~/.codex/config.toml`. Update an existing `qingdan` entry rather than adding a duplicate.

```toml
[mcp_servers.qingdan]
command = "<Qingdan-executable-path-from-settings>"
args = ["--mcp"]

[mcp_servers.qingdan.env]
QINGDAN_AGENT_DESCRIPTOR = "<private-connection-file-path-from-settings>"
```

On Windows, use the environment variables shown in Qingdan instead of `QINGDAN_AGENT_DESCRIPTOR`.

[Codex configuration help](https://developers.openai.com/codex/mcp)

</details>

<details>
<summary>OpenCode</summary>

Merge `qingdan` into the `mcp` section of your existing `opencode.json` or `opencode.jsonc`.

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

On Windows, use the environment variables shown in Qingdan instead of `QINGDAN_AGENT_DESCRIPTOR`.

[OpenCode configuration help](https://opencode.ai/docs/mcp-servers/)

</details>

Start by asking your agent to list the allowed lists or find unfinished tasks. Check that the intended account and list are being used before asking for changes.

## Permissions and reconnecting

- Read access covers list names and task details, not comments, attachments, members or history. Existing account and list permissions still apply.
- Write access allows creating, editing and completing tasks, not deleting tasks or managing accounts. Completing a parent task may complete its subtasks; completing a recurring task may create its next occurrence.
- New lists are not automatically included. To change access, select the lists and permissions, review them and choose **Apply permissions and renew access**. Restart your MCP client afterward.
- Choose **Revoke agent access** to stop access immediately.
- Quitting Qingdan, signing out or switching servers ends access. Reopen settings, check the account and enable access again, then restart your MCP client. Access never silently switches to another account.
- On macOS/Linux, the same account and server keep the same connection-file path. On Windows, refresh the address and token as described above.

## Troubleshooting

If the agent cannot connect, check that Qingdan is open, the correct account is signed in, both Qingdan and your private server are updated, and the client has the current connection details. Do not expose the connection port to the internet.

If a task change fails or its outcome is unclear, check the task before retrying.

Linux requires working Electron sandbox support. Ubuntu 24.04 may prevent this version's AppImage from starting, even after extraction. Do not disable the sandbox to work around it; this version does not include a fix for that system restriction.
