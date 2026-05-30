# MCP Configuration Templates for Cloud189 Agent Safe Storage

Copy the relevant block into your agent's MCP configuration file.

## Hermes

```bash
hermes mcp add cloud189 --command node --args /ABSOLUTE/PATH/TO/node_modules/@codesentryai/cloud189/src/mcp-server.js
```

Or add to `~/.hermes/hermes-agent/config.yaml`:

```yaml
mcp:
  servers:
    cloud189:
      command: node
      args:
        - /ABSOLUTE/PATH/TO/node_modules/@codesentryai/cloud189/src/mcp-server.js
```

## Claude Code

Add to `~/.claude/.mcp.json` (or use `/mcp-add`):

```json
{
  "mcpServers": {
    "cloud189": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/node_modules/@codesentryai/cloud189/src/mcp-server.js"]
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
      command: node
      args:
        - /ABSOLUTE/PATH/TO/node_modules/@codesentryai/cloud189/src/mcp-server.js
```

## Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cloud189": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/node_modules/@codesentryai/cloud189/src/mcp-server.js"]
    }
  }
}
```

## Command-line (no agent)

After `npm install -g @codesentryai/cloud189`:

```bash
cloud189 login-qr
cloud189 init-agent hermes
cloud189 status
```
