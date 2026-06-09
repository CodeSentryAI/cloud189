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

## Common Commands (prefer --json for automation)

```bash
cloud189 login-qr                                   # QR login
cloud189 status --json                              # session & storage info
cloud189 list <folderId> --json                     # list files
cloud189 upload-safe <localPath> <writeRootId> --json        # agent-safe upload, no overwrite, DLG protected
cloud189 sync-upload-safe <localDir> <writeRootId> --once --json  # agent-safe sync, no delete, DLG protected
cloud189 download <fileId> <localPath> --json       # download file
cloud189 mkdir <parentId> <name> --json             # create folder
cloud189 search <keyword> --json                    # search
cloud189 agent-status --json                        # agent config & safety
cloud189 logout                                     # delete local session
```

Human raw CLI commands are separate and explicit:

```bash
cloud189 upload <smallFileOrSmallDir> <folderId>
cloud189 sync <smallFileOrSmallDir> <folderId>
cloud189 upload-large-file <file> <folderId>
cloud189 upload-large-dir <dir> <folderId>
cloud189 sync-large-file <file> <folderId>
cloud189 sync-large-dir <dir> <folderId>
cloud189 transfer-status <containerId> [--json]
```

`upload` / `sync` are for small objects only (<= 2 GiB; directories also <= 1000 files). Large objects must use the explicit large-object commands. Raw human CLI transfers do not run Data Leak Guard by default.

## MCP Server

Binary: `cloud189-mcp`

MCP tools are safe-only: `cloud189_status`, `cloud189_roots`, `cloud189_list`, `cloud189_tree`, `cloud189_search`, `cloud189_quota`, `cloud189_download`, `cloud189_upload_safe`, `cloud189_mkdir_safe`, `cloud189_sync_upload_safe`, and `cloud189_plan`.

MCP intentionally does not expose raw large-object commands (`upload-large-*`, `sync-large-*`, legacy `sync-upload`). Use CLI `transfer-status` for resumable container status until MCP job/status support exists.

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
- Agents should use `upload-safe` / `sync-upload-safe`, not raw `upload` / `sync`

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
