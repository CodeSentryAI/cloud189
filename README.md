# Agent Safe Storage

A command-based safe cloud storage layer for AI agents. Currently supports Cloud189.

面向 AI Agent 的命令式安全云存储层，目前支持天翼云盘。

## What Is This

This project provides a Node.js CLI and MCP server for Tianyi Cloud Disk through `cloud189-sdk`. It is designed for agent workflows that should search, download, upload, and sync files without mounting a cloud drive or giving an agent direct delete, move, rename, or overwrite operations.

## Why Not Mount Cloud Drive

The safety model is command based. Agents work with remote IDs returned by `roots`, `list`, `tree`, and `search`, then use explicit safe commands. Dangerous operations are represented as dry-run plans and require a human to execute raw commands manually.

## Install

```bash
npm install
./install.sh
```

Run locally without global linking:

```bash
./cloud189 status
npm start -- status
```

## QR Login

```bash
cloud189 login-qr
cloud189 status
```

Password and SSON login are also available:

```bash
cloud189 login --username <name> --password <password>
cloud189 login-sso --cookie <sson>
```

## Basic CLI Usage

```bash
cloud189 roots
cloud189 list <remoteFolderId>
cloud189 tree <remoteFolderId> --depth 2
cloud189 search "keyword" <remoteFolderId> --depth 3
cloud189 download <remoteId> ./downloads/file.md
```

Query commands support JSON:

```bash
cloud189 roots --json
cloud189 list <remoteFolderId> --json
cloud189 search "keyword" <remoteFolderId> --json
cloud189 status --json
```

## Agent-Safe Mode

Initialize an agent write root:

```bash
cloud189 init-agent hermes
cloud189 agent-status
```

Use safe write commands:

```bash
cloud189 upload-safe ./result.md <agentWriteRootId>
cloud189 mkdir-safe <agentWriteRootId> results
cloud189 sync-upload-safe ./results <agentWriteRootId> --once
```

Force agent-safe mode for any command:

```bash
cloud189 rm <remoteId> --mode agent-safe
```

That returns a denial. Use a plan instead:

```bash
cloud189 plan rm <remoteId>
```

Environment overrides:

```bash
CLOUD189_MODE=agent-safe
CLOUD189_AGENT_NAME=hermes
CLOUD189_WRITE_ROOT_ID=123456789
```

## MCP Setup

Start the MCP server with:

```bash
npm run mcp
```

The MCP server defaults to `agent-safe` mode and exposes only safe tools:

```text
cloud189_status
cloud189_roots
cloud189_list
cloud189_tree
cloud189_search
cloud189_quota
cloud189_download
cloud189_upload_safe
cloud189_mkdir_safe
cloud189_sync_upload_safe
cloud189_plan
```

Raw delete, move, rename, upload, sync-upload, and sync-download tools are not exposed.

## Hermes Skill Setup

A starter skill is included at:

```text
skills/cloud189-agent-storage/SKILL.md
```

Copy or reference that skill from your Hermes skill configuration.

## Safety Model

Agent-safe mode allows status, quota, roots, list, tree, search, download, safe mkdir, safe upload, safe upload sync, and plan.

It denies remote delete, move, rename, raw upload, raw sync-upload, and sync-download. `upload-safe`, `mkdir-safe`, and `sync-upload-safe` require the destination folder to match the configured agent write root ID in this phase.

`sync-upload-safe` never deletes remote files. Local deletions are ignored, remote-only files are ignored, and conflicting remote changes stop the sync.

## Docs

SDK reference notes:

```text
docs/quick_start.md
docs/api.md
```

Upstream SDK:

```text
https://github.com/wes-lin/cloud189-sdk/tree/main
```

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by China Telecom or Cloud189.
Cloud189 is currently supported as a storage provider.

## 免责声明

本项目不是天翼云盘官方项目，与中国电信/天翼云盘没有隶属、赞助或背书关系。
天翼云盘只是当前支持的一个存储后端。
