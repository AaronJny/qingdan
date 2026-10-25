# Connect an agent to Qingdan

[English](AGENT-ACCESS.md) · [简体中文](AGENT-ACCESS.zh-CN.md)

Qingdan's desktop app can connect an MCP-compatible agent to tasks in selected lists. The same local desktop gateway works with the app's built-in local data or with the private server account currently signed in. You do not configure a public or remote HTTP MCP server.

Agent access is available in v1.3.7 and later. Update both the desktop app and a connected private server before using it.

## Before you start

- Use a Qingdan desktop build with **Settings → Agent access** and an MCP client that can launch a local stdio process.
- Keep Qingdan running. For a private server, connect and sign in normally in Qingdan first. The agent does not receive your password, browser cookies or CSRF token.
- An updated packaged desktop build runs the adapter using the installed Qingdan executable with `--mcp`; no separate Node.js installation is needed. Settings shows the executable path. Source-only setup is described below.
- Agent access is off by default. Opening settings does not grant access. This does not provide local Android access, browser-only MCP hosting, or a cloud agent's direct connection to your laptop.

## Enable access deliberately

1. Open **Settings → Agent access** in Qingdan's desktop window.
2. Check the displayed server and account. Choose individual lists. There is no “all future lists” permission.
3. Leave task changes disabled for read-only access. Enable them only if your agent should create, edit or complete tasks.
4. Review the scope and check the confirmation box, then choose **Enable agent access**.
5. On macOS/Linux, Qingdan creates an owner-only local credential file and shows configuration that references its path. No token needs to be copied. On Windows, use the one-time token fallback described below. Restart the MCP client after every grant or renewal.

Read access includes list names and task titles, descriptions and supported task fields. It excludes comments, attachments, membership details and history. Write access currently covers task creation, supported field edits and completion, not arbitrary administration, file access, task deletion or list migration. Completing a parent task can also complete its subtasks; completing a recurring task can create the next instance. Existing account and list permissions still apply.

## Configure your MCP client

Select Codex or OpenCode in the settings panel before copying. Their formats differ; generic `mcpServers` JSON is not their configuration format. For Codex, merge the TOML into `~/.codex/config.toml`, updating an existing `[mcp_servers.qingdan]` entry rather than duplicating it. For OpenCode, merge `qingdan` into the `mcp` object of your existing `opencode.json` or `opencode.jsonc`. Preserve other settings and restart the client. Formats follow the [official Codex MCP configuration](https://developers.openai.com/codex/mcp) and [stable OpenCode MCP documentation](https://opencode.ai/docs/mcp-servers/).

On macOS/Linux, copy the configuration shown by the settings panel. The descriptor path is bound to this exact server and account; it is not a pointer to whichever account you open later.

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

The private file contains the current loopback endpoint and token. It is created only after you explicitly enable access and removed when you revoke access or quit normally. An interrupted exit can leave a stale file, but it cannot reactivate the expired grant. Re-enabling the same bound account and server restores the same path, so you do not need to edit this configuration each time. You must still restart the MCP process: it reads the credential file once, and a revoked process does not automatically adopt a newer grant. Another account or server gets a different path.

Keep the file private; do not upload it, commit it to source control or share its contents. Use the exact executable and credential paths shown by Qingdan. On macOS the command points to the executable inside the app bundle, not the `.app` folder; on Windows it points to `Qingdan.exe`. The `--mcp` process runs the stdio adapter without opening another GUI, but it still needs the already-running desktop gateway.

On Linux, the desktop and its MCP process require working Electron sandbox support. Ubuntu 24.04 may block an unpacked AppImage under its user-namespace policy; extracting it does not remove that restriction. Keep sandbox protection enabled. This version does not automatically change system security policy.

### Windows fallback

The initial implementation does not yet verify Windows credential-file ACLs, so it uses explicit environment variables instead:

#### Codex · config.toml

```toml
[mcp_servers.qingdan]
command = "C:\\path\\to\\Qingdan.exe"
args = ["--mcp"]

[mcp_servers.qingdan.env]
QINGDAN_AGENT_ENDPOINT = "http://127.0.0.1:<port-from-settings>/tools"
QINGDAN_AGENT_TOKEN = "<your-one-time-token>"
ELECTRON_NO_ATTACH_CONSOLE = "1"
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
        "QINGDAN_AGENT_TOKEN": "<your-one-time-token>",
        "ELECTRON_NO_ATTACH_CONSOLE": "1"
      },
      "enabled": true
    }
  }
}
```

Copy the token once into your MCP client's private configuration. Prefer its secure secret facility, if available. Then choose **Clear token** and clear your clipboard. Closing the panel also removes the displayed token; Qingdan does not show it again. Never put it in a URL, command-line argument, chat or screenshot. Use the endpoint shown in settings, not your private server URL. Update both endpoint and token after restarting Qingdan, and the token after renewing a grant.

You can start by asking your agent to list the allowed lists or find open tasks. Confirm that the intended account and list are being used before requesting changes. Agents should reuse the same operation ID when retrying an uncertain write and reread a task after a revision conflict, rather than silently overwriting a later edit.

### Running from source

For an unpackaged checkout, use Node.js 24. From `application`, run `npm ci` and `npm run build`. For Codex, set `command` to `node` (or its absolute path) and `args` to `["/absolute/path/to/qingdan/application/dist/server/mcp.mjs"]`. For OpenCode, set the `command` array to `["node", "/absolute/path/to/qingdan/application/dist/server/mcp.mjs"]`. Keep the same descriptor or Windows fallback variables under `env` or `environment`, respectively. Run Node directly rather than `npm run` to avoid package-manager output on the MCP stdio stream. Settings shows source-path placeholders when no packaged launcher is available.

## Change or revoke access

- Change the selected lists or read/write permission, review again, and choose **Apply permissions and renew access**. This replaces the old credential. Restart the MCP client; on Windows also update the token configuration.
- Choose **Revoke agent access** to stop access immediately. No confirmation box is needed to revoke.
- Grants are session-only. Quitting/restarting Qingdan, signing out or switching server invalidates access. Reopen settings, verify the target, grant access again, and restart your MCP client. The same target retains its descriptor path; on Windows refresh the endpoint and token.
- Access is bound to the verified account and server. It does not silently follow a newly selected account or server. Disconnected or unauthenticated requests fail rather than being queued for later.

If a settings change has an uncertain outcome, reopen the panel to check its current state before renewing access. If the agent cannot connect, check that Qingdan is still running, the correct server/account is signed in, the private server supports this feature, and the configured credential file (or Windows endpoint and token) belongs to the current grant. Do not expose the gateway port on your network as a workaround.
