# @codesentryai/cloud189

> **CLI for Cloud189 Agent Storage — safe cloud storage for humans and AI agent workflows.**

Login with QR, upload/download files, search remote content, and manage agent-safe storage on Tianyi Cloud 189 / 天翼云盘.

## Packages

| Package | Install | What it provides |
|---|---|---|
| `@codesentryai/cloud189` | `npm install -g @codesentryai/cloud189` | CLI: `cloud189` binary + agent skill |
| `@codesentryai/cloud189-mcp` | `npm install -g @codesentryai/cloud189-mcp` | MCP server: `cloud189-mcp` binary |
| `@codesentryai/cloud189-setup` | `npx @codesentryai/cloud189-setup` | One-command installer |

Source code lives in one repo: [CodeSentryAI/cloud189](https://github.com/CodeSentryAI/cloud189)

## Quick Start

```bash
# 1. Install CLI
npm install -g @codesentryai/cloud189

# 2. (Optional) Install MCP server for AI agent tools
npm install -g @codesentryai/cloud189-mcp

# 3. Login via QR code
cloud189 login-qr

# 4. Verify
cloud189 status --json
```

## Human CLI API

Cloud189 separates simple human uploads from resumable large-object uploads.

### Simple upload / sync

Use `upload` and `sync` only for small objects:

- file size <= 2 GiB
- directory total size <= 2 GiB **and** file count <= 1000

```bash
cloud189 upload ./file.txt <remoteFolderId>
cloud189 upload ./small-dir <remoteFolderId>
cloud189 sync ./file.txt <remoteFolderId>
cloud189 sync ./small-dir <remoteFolderId>
```

If the path is too large, the CLI refuses and tells you which explicit large-object command to run.

### Resumable large-object upload / sync

Large files and large directories use explicit commands and create resumable containers:

```bash
cloud189 upload-large-file ./big.bin <remoteFolderId>   # creates big.bin.cloud189-split/
cloud189 upload-large-dir ./huge-dir <remoteFolderId>   # creates huge-dir.cloud189-dir/
cloud189 sync-large-file ./big.bin <remoteFolderId>
cloud189 sync-large-dir ./huge-dir <remoteFolderId>
```

If interrupted, rerun the same command to resume from uploaded chunks/bundles.

### Other CLI commands

```bash
cloud189 search "keyword"
cloud189 list -11
cloud189 download <remoteId> ./file.md
cloud189 quota
```

## Agent / MCP API

Agents should use safe tools rather than raw human CLI commands. Safe tools are JSON-oriented, Data-Leak-Guard protected, write-root constrained, and refuse overwrites/deletes by default:

```bash
cloud189 upload-safe ./result.md <writeRootId>
cloud189 sync-upload-safe ./results <writeRootId> --once
```

## Use as MCP Server

After installing the MCP package, `cloud189-mcp` is available as a binary.
Add it to your agent's MCP config:

### Hermes

```bash
hermes mcp add cloud189 --command cloud189-mcp
```

### Claude Code

```json
{ "mcpServers": { "cloud189": { "command": "cloud189-mcp" } } }
```

### OpenClaw

```yaml
mcp:
  servers:
    cloud189:
      command: cloud189-mcp
```

### Cursor

```json
{ "mcpServers": { "cloud189": { "command": "cloud189-mcp" } } }
```

See [`templates/MCP_CONFIGS.md`](templates/MCP_CONFIGS.md) for full examples.

## MCP Tools (11)

| Tool | Purpose |
|---|---|
| `cloud189_status` | Login state, config, write root |
| `cloud189_roots` | Root folder IDs (personal: -11, syncdisk: 0) |
| `cloud189_list` | List remote folder |
| `cloud189_tree` | Recursive listing |
| `cloud189_search` | Keyword search |
| `cloud189_quota` | Storage usage |
| `cloud189_download` | Download file/folder |
| `cloud189_upload_safe` | Upload to write root, no overwrite |
| `cloud189_mkdir_safe` | Idempotent mkdir in write root |
| `cloud189_sync_upload_safe` | Deletion-free one-shot sync |
| `cloud189_plan` | Dry-run plan for dangerous ops |

## Agent-Safe Mode

| Interface | Allowed by default | Denied / discouraged |
|---|---|---|
| Human CLI | raw `upload`, `upload-large-*`, `sync`, `sync-large-*`, download/list/search | destructive operations require explicit commands/plan |
| MCP / Agent | `upload-safe`, `sync-upload-safe`, list/search/download/status/plan | raw upload/sync, delete/move/rename |

MCP agents should use safe tools. Human operators may use raw CLI commands explicitly when targeting folders such as `/share`.

## Agent Storage Layout

Typical layout:

```text
/AgentStorage/
  memory/
  work-results/
  reports/
  logs/
  backups/
```

## Monorepo Layout

```text
cloud189/
├── packages/
│   ├── cli/       → @codesentryai/cloud189
│   ├── mcp/       → @codesentryai/cloud189-mcp
│   └── setup/     → @codesentryai/cloud189-setup
├── package.json   (root, private)
└── README.md
```

MCP server calls `cloud189 --json <command>` internally. Shared logic stays in the CLI; no `core` package needed until duplication becomes painful.

## License

MIT — [CodeSentryAI](https://github.com/CodeSentryAI)

## Disclaimer

Personal project. Not affiliated with or endorsed by Tianyi Cloud 189 / 天翼云盘 or any related official service.
