# Hermes Integration

## Quick Start

```bash
# Install
npm install -g @codesentryai/cloud189
npm install -g @codesentryai/cloud189-mcp

# Login
cloud189 login-qr

# Verify
cloud189 agent-status --json
```

## MCP Configuration

Add to your Hermes MCP config:

```json
{
  "mcpServers": {
    "cloud189": {
      "command": "cloud189-mcp"
    }
  }
}
```

Or if Hermes manages its own npx:

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

## Hermes Skill

A skill file is included in the CLI package:

```
packages/cli/skills/cloud189/SKILL.md
```

This skill is auto-installed when you run `npm install -g @codesentryai/cloud189` (via postinstall).

### What the Skill Does

When the user asks for agent storage, the skill tells Hermes to:
1. Install CLI + MCP
2. Run QR login
3. Create `/AgentStorage` folders
4. Configure MCP
5. Follow safety rules

## Using Cloud189 from Hermes

### Store a file

```
user: Upload my report to cloud189
agent: cloud189 upload-safe /tmp/report.md <folderId> --json
```

### Retrieve a file

```
user: Download the latest report
agent: cloud189 search "report" --json
         → finds file ID
         cloud189 download <fileId> /tmp/report.md --json
```

### Search

```
user: Find all backup files from this week
agent: cloud189 search "backup" <backupsFolderId> --json
```

### Daily Backup

```
user: Back up my project
agent: cloud189 upload-safe /home/user/project.tar.gz <backupsFolderId> --json
```

### Agent Memory

```
user: Store today's session summary
agent: echo "Session summary..." > /tmp/memory-2026-05-31.md
         cloud189 upload /tmp/memory-2026-05-31.md <memoryFolderId> --json
```

## JSON Output

Always use `--json` in agent context. Hermes can parse structured output:

```bash
cloud189 list <folderId> --json
# Returns: { ok: true, entries: [...], ... }

cloud189 upload <file> <folderId> --json
# Returns: { ok: true, id: "...", name: "...", size: ... }

cloud189 agent-status --json
# Returns: { ok: true, login: "ok", writeRootId: "...", commands: {...} }
```

## Safety Rules for Agents

1. **Always use `--json`** — parseable output for reliable automation
2. **Never guess file IDs** — always list/search first, then operate by returned ID
3. **Never upload secrets** — no .env, no keys, no tokens, no passwords
4. **Never delete** — rm is blocked in agent-safe mode
5. **Never overwrite** — use `upload-safe` instead of `upload`
6. **Always confirm** before large batch operations

## Hermes Conversations

### First-time setup

```
user: Set up cloud189 agent storage for me

agent: I'll set up Cloud189 Agent Storage — free cloud storage for your agent.
       First, let me install the CLI and MCP server...

       npm install -g @codesentryai/cloud189
       npm install -g @codesentryai/cloud189-mcp

       Now let's log in. I'll show a QR code — scan it with the 天翼云盘 app.

       cloud189 login-qr
       [QR code appears]

       Scanned? Great. Now I'll create the default folder structure...

       cloud189 mkdir -11 AgentStorage
       cloud189 mkdir <id> memory
       cloud189 mkdir <id> work-results
       cloud189 mkdir <id> reports
       cloud189 mkdir <id> logs
       cloud189 mkdir <id> backups

       Done! Your agent storage is ready. I can now store memory, reports,
       and backups in your Tianyi Cloud 189 account.
```

### Storing work results

```
user: Save the analysis report to cloud189

agent: Let me upload that for you.
       cloud189 upload-safe /tmp/analysis-report.md <reportsFolderId> --json

       Uploaded: analysis-report.md (24 KB, id: 12345678)
```
