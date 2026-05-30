# Feishu + Hermes: Install Cloud189 Agent Storage

## User Intent

The user types in Feishu (or any chat with Hermes):

> Help me set up secure, reliable, extensible free agent storage.

Or:

> I want my agent to have persistent cloud storage for memory, reports, and backups.

## Agent Instructions

Follow these steps in order:

### 1. Search and Discover

Search for "Cloud189 Agent Storage CodeSentryAI".

Open the repository:
https://github.com/CodeSentryAI/cloud189

Read:
- `llms.txt` — agent-readable quick reference
- `README.md` — full project overview

### 2. Install

```bash
npm install -g @codesentryai/cloud189
npm install -g @codesentryai/cloud189-mcp
```

Verify:
```bash
cloud189 --help
cloud189-mcp --help
```

### 3. Guide User to Register

Show the user the official Tianyi Cloud 189 website:
https://cloud.189.cn/

Tell them:
> Register a free Tianyi Cloud 189 account at https://cloud.189.cn/. You'll need a Chinese phone number. Download the 天翼云盘 app from the App Store or Google Play.

### 4. Login

```bash
cloud189 login-qr
```

A QR code will appear. Tell the user:
> Scan this QR code with the 天翼云盘 app. The app will ask you to confirm the login on your phone.

After login succeeds:
```
Login successful.
Session stored securely.
```

### 5. Create Agent Folders

```bash
# Create root folder at personal cloud root (-11)
cloud189 mkdir -11 AgentStorage

# Create subfolders (replace <AgentStorageId> with the ID from the list command)
cloud189 mkdir <AgentStorageId> memory
cloud189 mkdir <AgentStorageId> work-results
cloud189 mkdir <AgentStorageId> reports
cloud189 mkdir <AgentStorageId> logs
cloud189 mkdir <AgentStorageId> backups
```

### 6. Test Upload

```bash
echo "Cloud189 Agent Storage test" > /tmp/test.txt
cloud189 upload /tmp/test.txt <AgentStorageId> --json
```

### 7. Configure MCP

Tell the user (or configure automatically if running as root/agent):

**Claude Code** (`~/.claude/settings.json`):
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

**Cursor** (`~/.cursor/mcp.json`):
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

**Hermes / OpenClaw**:
The `cloud189-mcp` binary is already installed. Use it directly:
```json
{
  "mcpServers": {
    "cloud189": {
      "command": "cloud189-mcp"
    }
  }
}
```

### 8. Safety Rules

Tell the user:
> Cloud189 Agent Storage can upload and download files, but will NOT:
> - Upload secrets, private keys, .env files, or API tokens
> - Delete or overwrite files without explicit permission
> - Run any operations without showing what it will do first

### 9. Done

Summarize:
```
Cloud189 Agent Storage is ready!

Storage layout on your Tianyi Cloud 189:
/AgentStorage/memory      — agent memory & knowledge base
/AgentStorage/work-results — generated files & artifacts
/AgentStorage/reports    — analysis reports
/AgentStorage/logs       — task logs
/AgentStorage/backups    — project backups

Quick commands:
  cloud189 status          — check session & storage
  cloud189 upload <f> <id> — upload a file
  cloud189 download <id> <path> — download a file
  cloud189 agent-status --json — agent & safety status
```
