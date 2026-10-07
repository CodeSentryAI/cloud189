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
- Cloud storage tools for status, roots, quota, list, tree, search, download, upload-safe, mkdir-safe, sync-upload-safe, plan, rename-folder, rename-file, rm, and mv
- Agent-safe behavior: no delete/overwrite by default; destructive tools require `confirm: true` and a `cloud189_plan` preview
- MCP intentionally does **not** expose raw human large-object commands (`upload-large-*`, `sync-large-*`, or legacy `sync-upload`)
- Downloads are restricted to the MCP workspace (default: OS temp dir and `~/cloud189`; override with `CLOUD189_MCP_WORKSPACE`)
- Child CLI calls have bounded timeouts (`CLOUD189_MCP_TIMEOUT_MS`, default 30 min; `CLOUD189_MCP_TRANSFER_TIMEOUT_MS`, default 12 h)

Human large-object transfers are CLI-only for now. Use `cloud189 transfer-status <remoteContainerId>` from the CLI to inspect resumable `.cloud189-split/` and `.cloud189-dir/` containers; MCP job/status support is future work.

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
