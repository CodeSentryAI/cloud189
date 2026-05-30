---
name: cloud189
description: "Use when the user asks to interact with Tianyi Cloud Disk (天翼云盘) via agent-safe cloud189 CLI/MCP — search, download, upload-safe, sync-upload-safe, plan mode, agent-safe rules, write-root management."
version: 1.0.0
author: CodeSentryAI
license: MIT
metadata:
  hermes:
    tags: [cloud-storage, cloud189, tianyi, agent-safe, mcp]
    related_skills: [native-mcp, mcporter]
---

# Cloud189 — Agent-Safe Tianyi Cloud Disk

## Overview

Command-based safe cloud storage for AI agents. Remote IDs only — no mount,
no direct filesystem. Agents can search, download, upload, and sync but
**cannot delete, move, rename, or overwrite** remote files.

| Component | Path |
|---|---|
| CLI binary | `cloud189` ( global ) or `npx @codesentryai/cloud189` |
| MCP server | `node src/mcp-server.js` inside this package |
| Agent config | `~/.cloud189-agent/config.json` |
| Skill (this file) | `skills/cloud189/SKILL.md` in this repo |

## MCP Tools (11)

| Tool | Purpose |
|---|---|
| `cloud189_status` | Login state, config dir, write root |
| `cloud189_roots` | Root folder IDs (personal: -11, syncdisk: 0) |
| `cloud189_list` | List remote folder |
| `cloud189_tree` | Recursive listing |
| `cloud189_search` | Keyword search |
| `cloud189_quota` | Storage usage (total/used/available) |
| `cloud189_download` | Download file/folder |
| `cloud189_upload_safe` | Upload to write root, no overwrite |
| `cloud189_mkdir_safe` | Idempotent mkdir in write root |
| `cloud189_sync_upload_safe` | Deletion-free one-shot sync |
| `cloud189_plan` | Dry-run plan for dangerous ops |

## Agent-Safe Mode Rules

**Allowed:** login, login-qr, login-sso, status, quota, roots, list, tree, search,
download, mkdir, mkdir-safe, upload-safe, sync-upload-safe, sync-download, plan,
init-agent, agent-status

**Denied:** rm, mv, rename-folder, raw upload, raw sync-upload

If a denied operation is requested:
1. Use `cloud189 plan` to generate a dry-run plan.
2. Show `intent` + `potentialImpact` to the user.
3. Wait for explicit **approve**.
4. If approved, switch to `CLOUD189_MODE=user` and run the raw CLI yourself and report.

## Write Root

All safe uploads target a configured agent write root (default folder:
`/Agents/hermes` on the cloud disk).  Config stored in
`~/.cloud189-agent/config.json`.

```bash
cloud189 init-agent hermes
cloud189 agent-status --json
```

## Common Workflows

### Upload Results

```bash
cloud189_status                         # get writeRootId
cloud189_upload_safe /tmp/result.md <writeRootId>
# CONFLICT → inform user, do not overwrite
```

### Download & Analyse

```bash
cloud189_search "keyword"               # get remoteId
cloud189_download <remoteId> /tmp/file.md
```

### Safe Delete (requires user approval)

```bash
cloud189_plan rm <remoteId>             # dry-run
# → show plan.intent + plan.potentialImpact
# → wait for "approve"
cloud189 rm <remoteId>                  # only after approval
```

### Sync Directory

```bash
cloud189_sync_upload_safe ./results <writeRootId> --once
# Stops on CONFLICT — never deletes remote files
```

## Multi-Agent MCP Setup

See `templates/MCP_CONFIGS.md` for Hermes / Claude Code / OpenClaw / Cursor
configuration blocks.

## Common Pitfalls

1. **upload-safe requires writeRootId** — run `cloud189 init-agent <name>` first.
2. **CONFLICT stops upload** — never overwrite, inform user.
3. **MCP tools appear only after new agent session** — restart after setup.
4. **Never display tokens/passwords** in conversation output.
5. **Large files (>1 GB)** may time out — use background upload.

## Verification Checklist

- [ ] `npm install -g @codesentryai/cloud189` succeeds
- [ ] `cloud189 status --json` shows `tokenCache: "present"`
- [ ] `cloud189 agent-status --json` shows `writeRootId` is set
- [ ] Agent MCP tools appear (11 tools)
- [ ] Upload test: `cloud189 upload-safe /tmp/test.md <writeRootId>` succeeds
- [ ] Denied test: `cloud189 rm 123 --mode agent-safe` returns error
