# @codesentryai/cloud189-setup

One-command setup for Cloud189 Agent Storage.

```bash
npx @codesentryai/cloud189-setup
```

Installs CLI + MCP, runs QR login, creates /AgentStorage folders, enables Data Leak Guard, and prints MCP config.

Created folders:

- `/AgentStorage/memory`
- `/AgentStorage/work-results`
- `/AgentStorage/reports`
- `/AgentStorage/logs`
- `/AgentStorage/backups`

Default policy location:

- `~/.config/cloud189/security/policy.json`

See: https://github.com/CodeSentryAI/cloud189

## Disclaimer

Personal project. Not affiliated with or endorsed by Tianyi Cloud 189 / 天翼云盘 or any related official service.
