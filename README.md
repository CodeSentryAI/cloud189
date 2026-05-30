# Cloud189 Agent Safe Storage

> **Command-based safe cloud storage for AI agents.**
> Search, download, upload, sync — without giving agents delete / move / overwrite powers.

## Packages

| Package | Install | What it provides |
|---|---|---|
| `@codesentryai/cloud189` | `npm install -g @codesentryai/cloud189` | CLI: `cloud189` binary + agent skill |
| `@codesentryai/cloud189-mcp` | `npm install -g @codesentryai/cloud189-mcp` | MCP server: `cloud189-mcp` binary (11 tools) |

## Quick Start

```bash
npm install -g @codesentryai/cloud189         # CLI
npm install -g @codesentryai/cloud189-mcp     # MCP server (optional)
cloud189 login-qr
cloud189 init-agent hermes
cloud189 status --json
```

## Monorepo Layout

```
cloud189/
├── packages/
│   ├── cli/       → @codesentryai/cloud189      (CLI binary + skill)
│   └── mcp/       → @codesentryai/cloud189-mcp   (MCP server binary)
├── package.json   (root, private)
└── README.md
```

## License

MIT — [CodeSentryAI](https://github.com/CodeSentryAI)
