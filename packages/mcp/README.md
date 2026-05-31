# @codesentryai/cloud189-mcp

> **MCP server for Cloud189 Agent Storage.**

Adds Cloud189 / Tianyi Cloud 189 tools to AI agents through MCP, with agent-safe defaults for storage workflows.

## Install

```bash
npm install -g @codesentryai/cloud189
npm install -g @codesentryai/cloud189-mcp
```

## What it provides

- `cloud189-mcp` MCP server binary
- Cloud storage tools for list, search, download, upload-safe, mkdir-safe, sync-upload-safe, quota, and planning dangerous ops
- Agent-safe behavior: no delete/overwrite by default

## Example MCP config

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

See the main repo for full docs and platform-specific setup:

- https://github.com/CodeSentryAI/cloud189
- https://github.com/CodeSentryAI/cloud189/blob/main/docs/mcp-config.md

## Disclaimer

Personal project. Not affiliated with or endorsed by Tianyi Cloud 189 / 天翼云盘 or any related official service.
