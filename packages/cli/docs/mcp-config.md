# MCP Configuration

## Claude Code

Edit `~/.claude/settings.json`:

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

Or with globally installed binary:

```json
{
  "mcpServers": {
    "cloud189": {
      "command": "cloud189-mcp"
    }
  }
}
```

## Cursor

Edit `~/.cursor/mcp.json`:

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

## Hermes / OpenClaw

Use the globally installed binary:

```json
{
  "mcpServers": {
    "cloud189": {
      "command": "cloud189-mcp"
    }
  }
}
```

Or via npx:

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

## VS Code (Continue, Cline, etc.)

Edit your MCP settings JSON:

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

## Verification

After adding the config, restart your agent/IDE and verify:

```
# Should show cloud189-mcp in the list of connected MCP servers
# Try: "List files in my cloud189 root folder"
```

Or test the binary directly:

```bash
# Send a JSON-RPC initialize request
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | cloud189-mcp
```
