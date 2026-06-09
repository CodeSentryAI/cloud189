# Cloud189 Agent Storage

> **Secure, reliable, extensible, free cloud storage for AI agents, powered by Tianyi Cloud 189 / 天翼云盘.**

Cloud189 Agent Storage lets Hermes, Claude Code, OpenClaw, Cursor, VPS agents, and automation scripts store daily memory, work results, reports, logs, and backups in Tianyi Cloud 189.

## Agent Install

Ask your agent:

> Install Cloud189 Agent Storage from CodeSentryAI. Use npm package @codesentryai/cloud189 and MCP package @codesentryai/cloud189-mcp. Read https://github.com/CodeSentryAI/cloud189/blob/main/llms.txt first.

Or run:

```bash
# CLI + MCP
npm install -g @codesentryai/cloud189
npm install -g @codesentryai/cloud189-mcp

# Or one-command setup
npx @codesentryai/cloud189-setup

# Login (scan QR code with 天翼云盘 app)
cloud189 login-qr
```

## Register Tianyi Cloud 189

**Official website:** https://cloud.189.cn/

1. Register a free account at https://cloud.189.cn/
2. Download the 天翼云盘 app (iOS/Android)
3. Run `cloud189 login-qr` and scan the code

No API keys. No OAuth. Just scan and go.

## What It Does

| Use Case | Folder |
|---|---|
| Agent memory, knowledge base | `/AgentStorage/memory/` |
| Work results, generated files | `/AgentStorage/work-results/` |
| Reports, analysis | `/AgentStorage/reports/` |
| Task logs, audit trails | `/AgentStorage/logs/` |
| Project backups, snapshots | `/AgentStorage/backups/` |

## Why Cloud189 Agent Storage?

| | Cloud189 Agent Storage | Others (rclone, Drive MCP, S3 MCP) |
|---|---|---|
| **Cost** | Free consumer cloud disk | Paid or commercial |
| **Login** | QR scan — no API keys | OAuth, API keys, service accounts |
| **Install** | `npx @codesentryai/cloud189-setup` | Manual config |
| **Secret protection** | Data Leak Guard on safe/agent upload surfaces (blocks .env, keys) | None built-in |
| **Agent safety** | No delete/overwrite by default | Full CRUD unless restricted |
| **Session** | AES-256-GCM encrypted | Varies |
| **Protocol** | MCP + CLI + Skills | CLI only or generic MCP |
| **Use case** | Agent cold storage, backups, memory | General file sync |

## Security Definition

We define security concretely — not just "secure":

- **Secure** = no password stored by agent, QR login, local session file, explicit upload/download, no mount daemon, JSON audit logs
- **Reliable** = explicit operations, resumable upload/download, retry, checksum
- **Extensible** = CLI + MCP + skills + scriptable JSON
- **Free** = uses your own Tianyi Cloud 189 account

## Security Notes

Cloud189 Agent Storage is designed for **agent work artifacts**: reports, logs, generated files, backups.

**Do NOT upload:**
- Private keys (RSA, EC, Ed25519)
- Seed phrases
- API keys and tokens
- `.env` files
- Production secrets
- Unencrypted customer data

**For sensitive data: encrypt before upload.**

The Data Leak Guard protects `upload-safe`, `sync-upload-safe`, and MCP safe upload tools. Raw human CLI transfers (`upload`, `sync`, `upload-large-*`, `sync-large-*`, and legacy `sync-upload`) are explicit user-directed commands and do not run DLG by default. Configure policy at `~/.config/cloud189/security/policy.json`.

## MCP Configuration

### Claude Code (~/.claude/settings.json)

```json
{
  "mcpServers": {
    "cloud189": {
      "command": "npx",
      "args": ["-y", "@codesentryai/cloud189-mcp"]
    }
  }
}
```

### Cursor (~/.cursor/mcp.json)

```json
{
  "mcpServers": {
    "cloud189": {
      "command": "npx",
      "args": ["-y", "@codesentryai/cloud189-mcp"]
    }
  }
}
```

### Hermes / OpenClaw

See [docs/mcp-config.md](docs/mcp-config.md) for all platforms.

## Quick Reference

```bash
cloud189 login-qr                              # scan QR with 天翼云盘 app
cloud189 status --json                         # storage & session info
cloud189 list -11 --json                       # list root files
cloud189 upload <smallFileOrSmallDir> <folderId>        # human small upload
cloud189 upload-large-file <file> <folderId>            # resumable .cloud189-split/
cloud189 upload-large-dir <dir> <folderId>              # resumable .cloud189-dir/
cloud189 sync <smallFileOrSmallDir> <folderId>          # human small sync
cloud189 sync-large-file <file> <folderId>              # resumable large-file sync
cloud189 sync-large-dir <dir> <folderId>                # resumable large-dir sync
cloud189 transfer-status <containerId> --json           # inspect resumable container
cloud189 upload-safe <file> <writeRootId> --json        # agent-safe upload (no overwrite)
cloud189 sync-upload-safe <dir> <writeRootId> --once    # agent-safe one-shot sync
cloud189 download <fileId> <path> --json       # download
cloud189 mkdir -11 MyFolder --json             # create folder
cloud189 search "keyword" --json               # search files
cloud189 agent-status --json                   # agent config + safety status
cloud189 logout                                # delete local session
```

## Packages

| Package | Install | Purpose |
|---|---|---|
| `@codesentryai/cloud189` | `npm i -g @codesentryai/cloud189` | CLI for humans |
| `@codesentryai/cloud189-mcp` | `npm i -g @codesentryai/cloud189-mcp` | MCP server for agents |
| `@codesentryai/cloud189-setup` | `npx @codesentryai/cloud189-setup` | One-command installer |

## Documentation

- [docs/agent-install.md](docs/agent-install.md) — Agent install guide
- [docs/mcp-config.md](docs/mcp-config.md) — MCP config for all platforms
- [docs/security.md](docs/security.md) — Security architecture
- [docs/hermes.md](docs/hermes.md) — Hermes integration
- [docs/feishu-hermes-agent-storage.md](docs/feishu-hermes-agent-storage.md) — Feishu + Hermes flow

## Launch Message

> I open-sourced Cloud189 Agent Storage: secure, reliable, extensible, free cloud storage for AI agents. It gives Hermes / Claude Code / OpenClaw / VPS agents a persistent storage backend for memory, work results, reports, logs, and backups using Tianyi Cloud 189 / 天翼云盘.
>
> Install: `npm install -g @codesentryai/cloud189` + `npm install -g @codesentryai/cloud189-mcp`
> Login: `cloud189 login-qr`
> Agent docs: https://github.com/CodeSentryAI/cloud189/blob/main/llms.txt

## Disclaimer

Personal project. Not affiliated with or endorsed by Tianyi Cloud 189 / 天翼云盘 or any related official service. Please use at your own discretion.

## License

MIT — CodeSentryAI
