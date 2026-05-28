---
name: cloud189-agent-storage
description: Use Agent Safe Storage with Cloud189 provider to search, download, upload, and safely sync cloud files.
version: 0.1.0
---

# Cloud189 Agent Storage

Use Cloud189 as persistent storage for research results, generated files, shared files, and reusable knowledge.

This is not a mounted drive. Always use CLI or MCP commands.

## Safety Rules

1. Always use agent-safe mode.
2. Cloud189 operations require remote IDs, not paths.
3. Use roots, list, tree, and search to find remote IDs before acting.
4. Never delete, move, rename, or overwrite remote files.
5. Use upload-safe for uploads.
6. Use sync-upload-safe for safe backup-style sync.
7. If an operation may delete, move, rename, or overwrite, use plan and ask the user to execute it manually.
8. If multiple files have the same name, do not guess. Show candidates.

## Common Workflow

1. Check status.
2. Search existing cloud knowledge.
3. Download needed files into the local workspace.
4. Do the work.
5. Save final results as Markdown or another user-requested format.
6. Upload with upload-safe or sync-upload-safe.

## Common Commands

Check login:

```bash
cloud189 status --mode agent-safe
```

List roots:

```bash
cloud189 roots --mode agent-safe
```

List folder:

```bash
cloud189 list <remoteFolderId> --mode agent-safe
```

Search:

```bash
cloud189 search "keyword" <remoteFolderId> --depth 3 --mode agent-safe
```

Download:

```bash
cloud189 download <remoteId> ./downloads/file.md --mode agent-safe
```

Safe upload:

```bash
cloud189 upload-safe ./result.md <agentWriteRootId> --mode agent-safe
```

Safe sync:

```bash
cloud189 sync-upload-safe ./results <agentWriteRootId> --once --mode agent-safe
```

Dangerous operation plan:

```bash
cloud189 plan rm <remoteId> --mode agent-safe
```
