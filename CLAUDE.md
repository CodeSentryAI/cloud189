# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`cloud189-cli` is a Node.js 16+ CLI for Tianyi Cloud Disk (天翼网盘). It wraps `cloud189-sdk` to provide login, file listing, upload/download, remote file management, and incremental sync.

## Common Commands

- **Run CLI locally**: `./cloud189 <command>` or `npm start -- <command>`
- **Install globally**: `./install.sh` (runs `npm install && npm link`)
- **Run tests**: `npm test` (uses Node.js built-in `node --test`)
- **Run a single test file**: `node --test test/cli.test.js`

## Architecture

### Entry Point
`bin/cloud189.js` requires `src/cli.js` and calls `main()` with `process.argv.slice(2)`. `cloud189` is a local wrapper for the same.

### CLI Dispatcher (`src/cli.js`)
`parseArgs()` splits positional args from `--key value` options. `main()` branches on `command` to call the appropriate handler. Most handlers instantiate a client via `createClient()` and delegate to a module below.

### SDK Client (`src/client.js`)
Creates `CloudClient` from `cloud189-sdk` with a `FileTokenStore` backed by `token.json` in the config directory. Supports password, QR, and SSO cookie login. Tokens are cached automatically by the SDK.

### Remote Operations (`src/remote.js`)
All cloud-side metadata operations. `listAll()` loops through paginated results (pageSize 60). `ensureRemoteFolderPath()` lazily creates folder hierarchies. `runBatchTask()` wraps `createBatchTask` + `checkTaskStatus` for delete/move. `collectRemoteTree()` recursively fetches the full remote file tree. `indexRemoteFilesByPath()` builds a Map for sync deduplication.

### Transfer (`src/transfer.js`)
Handles byte-level upload/download. Uploads go through `client.upload()`. Downloads fetch a temporary URL via `client.getFileDownloadUrl()` then stream via raw `http`/`https`. Directory uploads walk local files and call `ensureRemoteFolderPath()` for each subpath.

### Sync Engine (`src/sync.js`)
`runUploadPass()` first fetches the full remote tree, then for each local file:
1. If a same-size remote duplicate exists, delete extras and skip upload.
2. If state says unchanged and a remote file exists, skip.
3. Otherwise delete old remote versions and upload.
`runDownloadPass()` skips files whose `size`/`rev` match the saved state. `pollUpload`/`pollDownload` run on intervals (default 5s/30s) unless `--once` is passed.

### Sync State (`src/sync-state.js`)
`state.json` lives in the config directory and stores `{ uploads: { path: { size, mtimeMs, remoteFileId } }, downloads: { path: { size, rev, remoteFileId } }, operations: [] }`. Only the last 50 operations are retained.

### Config (`src/config.js`)
Config directory resolves to `~/.config/cloud189-cli/` (respects `XDG_CONFIG_HOME`) or `CLOUD189_CLI_HOME` if set. Use `CLOUD189_CLI_HOME=/tmp/...` for isolated testing.

## Key Constants

- Personal cloud root folder ID: `-11`
- SyncDisk root folder ID: `0`

## Testing

Tests use Node.js built-in `node:test` and `node:assert/strict`. Tests for sync logic mock the SDK client (`getListFiles`, `upload`, `createBatchTask`, etc.) and use temp directories.
