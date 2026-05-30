# Agent Install Guide

## One-Line Install

```bash
npx @codesentryai/cloud189-setup
```

This installs CLI + MCP, runs QR login, creates `/AgentStorage` folders, enables Data Leak Guard, and prints MCP config.

## Manual Install

```bash
npm install -g @codesentryai/cloud189
npm install -g @codesentryai/cloud189-mcp
cloud189 login-qr
```

## Register Tianyi Cloud 189

1. Go to https://cloud.189.cn/
2. Register a free account (phone number required)
3. Download the 天翼云盘 app (iOS/Android)
4. Run `cloud189 login-qr` and scan the QR code

## Verify

```bash
cloud189 --help
cloud189 status --json
cloud189 agent-status --json
cloud189-mcp --help
```

## Create Agent Folders

```bash
cloud189 mkdir -11 AgentStorage
cloud189 mkdir <AgentStorageId> memory
cloud189 mkdir <AgentStorageId> work-results
cloud189 mkdir <AgentStorageId> reports
cloud189 mkdir <AgentStorageId> logs
cloud189 mkdir <AgentStorageId> backups
```

Or just run `npx @codesentryai/cloud189-setup` — it does all of the above.

## Configure MCP

See [mcp-config.md](mcp-config.md) for Claude Code, Cursor, Hermes, and OpenClaw config snippets.

## Next Steps

- Read [security.md](security.md) for safety rules
- Read [hermes.md](hermes.md) for Hermes-specific instructions
- Ask your agent to store its memory in `/AgentStorage/memory/`
