# MCP Configuration Templates for Cloud189

Copy the relevant block into your agent's MCP configuration file.

## Hermes

```bash
hermes mcp add cloud189 --command cloud189-mcp
```

Or add to `~/.hermes/hermes-agent/config.yaml`:

```yaml
mcp:
  servers:
    cloud189:
      command: cloud189-mcp
```

## Claude Code

Add to `~/.claude/.mcp.json` (or use `/mcp-add`):

```json
{
  "mcpServers": {
    "cloud189": {
      "command": "cloud189-mcp"
    }
  }
}
```

## OpenClaw

Add to `~/.openclaw/config.yaml`:

```yaml
mcp:
  servers:
    cloud189:
      command: cloud189-mcp
```

## Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cloud189": {
      "command": "cloud189-mcp"
    }
  }
}
```

## Installation

```bash
# Install the CLI
npm install -g @codesentryai/cloud189

# Install the MCP server
npm install -g @codesentryai/cloud189-mcp
```
