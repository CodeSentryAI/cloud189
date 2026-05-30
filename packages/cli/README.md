# Cloud189 Agent Safe Storage

> **Command-based safe cloud storage for AI agents.**
> Search, download, upload, sync — without giving agents delete / move / overwrite powers.

## Packages

| Package | Install | What it provides |
|---|---|---|
| `@codesentryai/cloud189` | `npm install -g @codesentryai/cloud189` | CLI: `cloud189` binary + agent skill |
| `@codesentryai/cloud189-mcp` | `npm install -g @codesentryai/cloud189-mcp` | MCP server: `cloud189-mcp` binary (11 tools) |

Source code lives in one repo: [CodeSentryAI/cloud189](https://github.com/CodeSentryAI/cloud189)

## Quick Start

```bash
# 1. Install CLI
npm install -g @codesentryai/cloud189

# 2. (Optional) Install MCP server for AI agent tools
npm install -g @codesentryai/cloud189-mcp

# 3. Login via QR code
cloud189 login-qr

# 4. Initialize agent working directory
cloud189 init-agent hermes

# 5. Verify
cloud189 status --json
```

## Use as CLI

```bash
cloud189 search "keyword"
cloud189 list -11
cloud189 download <remoteId> ./file.md
cloud189 upload-safe ./result.md <writeRootId>
cloud189 sync-upload-safe ./results <writeRootId> --once
cloud189 quota
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

| Allowed | Denied |
|---|---|
| login, login-qr, login-sso, status, quota, roots, list, tree, search, download, mkdir, mkdir-safe, upload-safe, sync-upload-safe, sync-download, plan | rm, mv, rename-folder, raw upload, raw sync-upload |

Denied operations return `DENIED_AGENT_SAFE`. Use `cloud189 plan <cmd>` instead.

## Write Root

All safe uploads target a configured agent write root (default: `/Agents/hermes`).
Config stored in `~/.cloud189-agent/config.json`.

## Monorepo Layout

```
cloud189/
├── packages/
│   ├── cli/       → @codesentryai/cloud189      (CLI binary + skill)
│   └── mcp/       → @codesentryai/cloud189-mcp   (MCP server binary)
├── package.json   (root, private)
└── README.md
```

MCP server calls `cloud189 --json <command>` internally. Shared logic
stays in the CLI; no `core` package needed until duplication becomes painful.

## License

MIT — [CodeSentryAI](https://github.com/CodeSentryAI)

## Disclaimer

Not affiliated with, endorsed by, or sponsored by China Telecom / Cloud189.
Cloud189 is the currently supported storage provider backend.
