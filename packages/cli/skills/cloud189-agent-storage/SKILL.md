---
name: cloud189-agent-storage
description: Cloud189 Agent Storage — secure, reliable, extensible, free cloud storage for AI agents, powered by Tianyi Cloud 189 / 天翼云盘. Use when the user wants to set up persistent agent storage for memory, work results, reports, logs, or backups.
---

# Cloud189 Agent Storage

Use this skill when the user wants persistent, free, reliable cloud storage for agent memory, work results, backups, logs, or reports.

## What It Is

Cloud189 Agent Storage gives AI agents (Hermes, Claude Code, OpenClaw, Cursor, VPS automation) a persistent storage backend in the user's own Tianyi Cloud 189 account.

**Positioning:** Cloud189 Agent Storage = free persistent cloud storage for AI agents. CLI for humans. MCP for agents. Data Leak Guard for safety.

## Install

```bash
npm install -g @codesentryai/cloud189
npm install -g @codesentryai/cloud189-mcp
```

Or one-command:
```bash
npx @codesentryai/cloud189-setup
```

## Login

```bash
cloud189 login-qr
```

Shows QR code. User scans with 天翼云盘 app. No API keys needed.

Official Tianyi Cloud 189 website: https://cloud.189.cn/

## Default Folder Layout

```
/AgentStorage/
├── memory/         — agent memory, session summaries, knowledge base
├── work-results/   — generated work artifacts, output files
├── reports/        — analysis reports, summaries
├── logs/           — task logs, audit trails
└── backups/        — project backups, snapshots
```

## Common Commands (always use --json)

```bash
cloud189 login-qr                                   # QR login
cloud189 status --json                              # session & storage info
cloud189 list <folderId> --json                     # list files
cloud189 upload <localPath> <folderId> --json       # upload file
cloud189 upload-safe <localPath> <folderId> --json  # upload (no overwrite)
cloud189 download <fileId> <localPath> --json       # download file
cloud189 mkdir <parentId> <name> --json             # create folder
cloud189 search <keyword> --json                    # search
cloud189 agent-status --json                        # agent config & safety
cloud189 logout                                     # delete local session
```

## MCP Server

Binary: `cloud189-mcp`

MCP tools: `cloud189_login_qr`, `cloud189_list`, `cloud189_search`, `cloud189_upload`, `cloud189_download`, `cloud189_mkdir`, `cloud189_delete`, `cloud189_backup_directory`

## MCP Config Snippet

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

## Safety Rules

**Always:**
- Use `--json` output for reliable parsing
- List/search first, then operate by returned ID (never guess IDs)
- Use `upload-safe` instead of `upload` (prevents overwrite)

**Never:**
- Upload private keys (RSA, EC, Ed25519)
- Upload .env files or API tokens
- Upload passwords or production secrets
- Delete files unless explicitly asked
- Overwrite files without confirmation

**For sensitive data: encrypt before upload.**

## When User Asks to Set Up Agent Storage

1. Install CLI + MCP
2. Guide user to register at https://cloud.189.cn/
3. Run `cloud189 login-qr` and show QR code
4. Create `/AgentStorage` and subfolders
5. Test upload/download
6. Configure MCP for the user's agent platform

## Docs

- Repository: https://github.com/CodeSentryAI/cloud189
- Agent install: https://github.com/CodeSentryAI/cloud189/blob/main/docs/agent-install.md
- MCP config: https://github.com/CodeSentryAI/cloud189/blob/main/docs/mcp-config.md
- Security: https://github.com/CodeSentryAI/cloud189/blob/main/docs/security.md
- Hermes guide: https://github.com/CodeSentryAI/cloud189/blob/main/docs/hermes.md
- Agent quickref: https://github.com/CodeSentryAI/cloud189/blob/main/llms.txt
