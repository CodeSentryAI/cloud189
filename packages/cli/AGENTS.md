# Repository Guidelines

## Project Structure & Module Organization

This repository implements a Node.js CLI for Tianyi Cloud Disk through `cloud189-sdk`.

- `bin/cloud189.js` is the executable entrypoint used by npm; `./cloud189` is the repo-local wrapper.
- `install.sh` installs dependencies and links the global `cloud189` command.
- `src/cli.js` parses commands and dispatches work, including password, QR, and SSON login.
- `src/client.js`, `src/remote.js`, `src/transfer.js`, and `src/sync.js` contain SDK setup, remote listing, file transfer, and incremental sync behavior.
- `src/config.js` and `src/sync-state.js` manage local config, token, and sync state paths.
- `test/` contains Node test runner tests. Keep fixtures under `test/fixtures/` if needed.
- `docs/` contains SDK reference notes copied from upstream.

Generated files, local config, tokens, and `node_modules/` must not be committed.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `./install.sh`: install dependencies and run `npm link` for the global `cloud189` command.
- `./cloud189 <command>`: run the local CLI directly, for example `./cloud189 status`.
- `npm start -- <command>`: run the same CLI through npm.
- `npm test`: run the Node built-in test suite.
- `npm ls --depth=0`: verify declared runtime dependencies.

The installed binary command is `cloud189` when this package is linked or installed.

## Coding Style & Naming Conventions

Use CommonJS modules and 2-space indentation. Keep command parsing in `src/cli.js`; put reusable behavior in focused modules under `src/`. Use camelCase for functions and variables, PascalCase only for classes, and descriptive command names such as `login-qr` and `sync-upload`.

Prefer Node built-ins before adding dependencies. Do not log passwords, access tokens, refresh tokens, cookies, or token file contents.

## Testing Guidelines

Use `node:test` with `node:assert/strict`. Test names should describe behavior, for example `parseArgs separates options and positional arguments`.

Default tests must not require real Tianyi Cloud credentials or network access. Mock SDK-facing behavior for command and transfer tests. Use temporary directories for config, token, state, and sync-file tests.

## Commit & Pull Request Guidelines

This repository has no established commit history yet. Use short, imperative commit subjects such as `Add sync status command` or `Test config path handling`.

Pull requests should include a concise summary, commands run for verification, and any credential or network requirements for manual testing. Link related issues when applicable.

## Security & Configuration Tips

The CLI stores tokens and sync state outside the repository by default in `~/.config/cloud189-cli/`, or in `CLOUD189_CLI_HOME` when set. Keep `.env.local`, token caches, downloaded private files, and generated sync state out of git. Use placeholders such as `username`, `password`, and `accessToken` in examples.
