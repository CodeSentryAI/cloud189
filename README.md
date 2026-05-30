# Cloud189 Agent Storage

> **Free cold storage for AI agent artifacts.**
> One-command setup. QR login. Data Leak Guard. MCP for agents.

Cloud189 Agent Storage gives your AI agent a free, persistent, encrypted cold-storage workspace in your own Tianyi Cloud 189 account (天翼云盘). It's the easiest way to store memory, reports, logs, backups, and work results — without giving agents dangerous powers like delete or overwrite.

## One-Command Setup

```bash
npx @codesentryai/cloud189-setup
```

This will:
1. Install the `cloud189` CLI and `cloud189-mcp` server
2. Show a QR code → scan with the 天翼云盘 app
3. Create `/AgentStorage/{memory,reports,logs,backups}` folder structure
4. Enable Data Leak Guard (blocks secret uploads by default)
5. Print MCP config for Claude Code / Cursor / Hermes
6. Test upload to verify everything works

That's it. Your agent now has free cloud storage.

## Packages

| Package | Purpose |
|---|---|
| `@codesentryai/cloud189` | CLI for humans — login, upload, download, sync, status |
| `@codesentryai/cloud189-mcp` | MCP server for agents — safe upload, download, search, plan |
| `@codesentryai/cloud189-setup` | One-command setup — installs everything, creates folders, enables safety |

## Why Cloud189 Agent Storage?

Not Google Drive MCP. Not S3 MCP. Not rclone.

| Feature | Cloud189 Agent Storage | Others |
|---|---|---|
| **Cost** | Free consumer cloud disk | Paid object storage or commercial cloud |
| **Login** | QR code scan — no API keys | OAuth flow, API keys, service accounts |
| **Install** | `npx @codesentryai/cloud189-setup` | Manual config, credentials, setup |
| **Secret protection** | Data Leak Guard — blocks `.env`, keys, tokens by default | No built-in policy |
| **Agent safety** | No delete, no overwrite, by default | Full CRUD unless manually restricted |
| **Encryption** | AES-256-GCM encrypted session storage | Varies |
| **MCP tools** | Purpose-built for agent workflows | Generic file operations |
| **Use case** | Cold storage, backups, memory, reports | General file sync |

## Safety Architecture

### Data Leak Guard
Agents can store artifacts, but cannot silently upload secrets.

- **Blocks:** `~/.ssh/*`, `.env`, `*.pem`, `id_rsa`, etc.
- **Detects:** API keys, bearer tokens, private key blocks, AWS keys
- **Policy:** Interactive → ask | Agent/MCP → deny by default | `--force-sensitive` to override
- **Audit:** All decisions logged to `~/.config/cloud189/audit.log`

### Agent-Safe Mode
Uploads are allowed, but dangerous commands are denied:
- **Allowed:** login, search, download, upload, mkdir, status
- **Denied:** rm, mv, rename-folder

### Session Security
- QR login → session stored as AES-256-GCM encrypted `session.enc`
- File permissions: `0600`, directory: `0700`
- Never printed: access tokens, refresh tokens, session keys

## Storage Layout (on cloud disk)

```
/AgentStorage/
├── memory/      — agent memory, session summaries, knowledge base
├── reports/     — generated reports, analysis results
├── logs/        — task logs, audit trails, execution history
└── backups/     — project backups, snapshots, archives
```

## Quick Reference

```bash
# Check status
cloud189 status
cloud189 status --json

# Upload a file (safe — no overwrite)
cloud189 upload-safe /path/to/file <folderId>

# Download
cloud189 download <remoteId> /local/path

# Search
cloud189 search "keyword" --depth 3

# Agent status (for AI agents)
cloud189 agent-status --json

# Logout
cloud189 logout
```

## MCP Configuration

### Claude Code (`~/.claude/settings.json`)
```json
{
  "mcpServers": {
    "cloud189": {
      "command": "npx",
      "args": ["@codesentryai/cloud189-mcp"]
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "cloud189": {
      "command": "npx",
      "args": ["@codesentryai/cloud189-mcp"]
    }
  }
}
```

## License

MIT — CodeSentryAI
