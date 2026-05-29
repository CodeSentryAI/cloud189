# Cloud189 Agent Safe Storage

> **Command-based safe cloud storage for AI agents.**
> Search, download, upload, sync — without giving agents delete / move / overwrite powers.

## Quick Install

```bash
npm install -g @agent-safe-storage/cloud189
```

After install, the postinstall script will guide you through MCP setup for
Hermes / Claude Code / OpenClaw / Cursor.

## First-time Setup

```bash
# Login (QR code scan)
cloud189 login-qr

# Initialize agent working directory on cloud disk
cloud189 init-agent hermes

# Verify
cloud189 agent-status --json
```

## Use as CLI

```bash
cloud189 search "keyword"
cloud189 download <remoteId> ./file.md
cloud189 upload-safe ./result.md <writeRootId>
cloud189 sync-upload-safe ./results <writeRootId> --once
cloud189 quota
```

## Use as MCP Server

```bash
# Manual start
npx @agent-safe-storage/cloud189 mcp

# Or let your agent runner start it via MCP config (see below)
```

### Hermes

```bash
hermes mcp add cloud189 \
  --command node \
  --args $(npm root -g)/@agent-safe-storage/cloud189/src/mcp-server.js
```

### Claude Code

Add to `~/.claude/.mcp.json`:

```json
{
  "mcpServers": {
    "cloud189": {
      "command": "node",
      "args": ["<global-node-modules>/@agent-safe-storage/cloud189/src/mcp-server.js"]
    }
  }
}
```

### OpenClaw

```yaml
# ~/.openclaw/config.yaml
mcp:
  servers:
    cloud189:
      command: node
      args: ["<global-node-modules>/@agent-safe-storage/cloud189/src/mcp-server.js"]
```

### Cursor

```json
// ~/.cursor/mcp.json
{
  "mcpServers": {
    "cloud189": {
      "command": "node",
      "args": ["<global-node-modules>/@agent-safe-storage/cloud189/src/mcp-server.js"]
    }
  }
}
```

See [`templates/MCP_CONFIGS.md`](templates/MCP_CONFIGS.md) for full examples.

## Agent-Safe Mode

| Allowed | Denied |
|---|---|
| status, quota, roots, list, tree, search, download, mkdir-safe, upload-safe, sync-upload-safe, plan | rm, mv, rename-folder, raw upload, raw sync-upload, sync-download |

Denied operations return `DENIED_AGENT_SAFE`. Use `cloud189 plan <cmd>` instead.

## Docs

| File | Description |
|---|---|
| `skills/cloud189/SKILL.md` | Agent skill (included in npm package) |
| `templates/MCP_CONFIGS.md` | MCP config blocks for all agents |
| `docs/USER_GUIDE.md` | Full user guide |
| `docs/EXAMPLES_AND_CHEATSHEET.md` | Examples + cheatsheet |
| `docs/HERMES_MCP_TUTORIAL.md` | Hermes-specific tutorial |
| `docs/TEST_REPORT.md` | Test report |

## Project Structure

```
bin/cloud189.js          # CLI entry
src/cli.js               # Command dispatcher
src/mcp-server.js        # MCP server (11 tools)
src/agent-safe.js        # Agent-safe mode enforcement
src/safe-storage.js      # Safe upload / mkdir / sync / plan
src/remote.js            # Remote listing / search / tree
src/transfer.js          # Upload / download
src/sync.js              # Incremental sync
src/sync-state.js        # Local sync state persistence
install.js               # postinstall hook (auto-setup guide)
skills/cloud189/         # Agent skill
templates/               # MCP config templates
```

## Running Tests

```bash
npm test
# 26 tests, all mock-based — no cloud credentials needed
```

## License

MIT

## Disclaimer

Not affiliated with, endorsed by, or sponsored by China Telecom / Cloud189.
Cloud189 is the currently supported storage provider backend.
