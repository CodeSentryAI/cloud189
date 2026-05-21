# Cloud189 CLI Usage

This CLI runs on Node.js 16+ and uses `cloud189-sdk` to access Tianyi Cloud Disk.

## Install

Use the installer to install dependencies and expose a global `cloud189` command:

```bash
./install.sh
```

Then run:

```bash
cloud189 <command>
```

Manual install is also supported. Install dependencies first:

```bash
npm install
```

Run commands from this repository with the local wrapper:

```bash
./cloud189 <command>
```

You can also use npm:

```bash
npm start -- <command>
```

For a global `cloud189` command without the installer, link this checkout once:

```bash
npm link
```

Then run:

```bash
cloud189 <command>
```

## Login

Login stores a token cache outside the repository.

```bash
npm start -- login --username "your-phone-or-email" --password "your-password"
```

Equivalent local-wrapper form:

```bash
./cloud189 login --username "your-phone-or-email" --password "your-password"
```

If password login fails with a secondary device verification message, use QR login:

```bash
npm start -- login-qr
```

Or:

```bash
./cloud189 login-qr
```

The command prints a QR image URL and waits until you scan and confirm it in the Tianyi Cloud mobile app. You can adjust polling:

```bash
npm start -- login-qr --timeout 180000 --interval 3000
```

If you already have an `SSON` browser cookie, you can login with it:

```bash
npm start -- login-sso --cookie "your-sson-cookie"
```

Default config location:

```text
~/.config/cloud189-cli/
```

Use a different location when testing:

```bash
CLOUD189_CLI_HOME=/tmp/cloud189-test npm start -- status
```

## Check Status

Show the config path, token cache status, state file status, and last sync operation:

```bash
npm start -- status
```

Or:

```bash
./cloud189 status
```

## List Remote Files

List files and folders in a remote folder:

```bash
npm start -- list <remoteFolderId>
```

Example:

```bash
npm start -- list 123456789
```

The output includes type, ID, name, size, and modified time. Use listed IDs for download and upload targets.

## Upload

Upload one file to a remote folder:

```bash
npm start -- upload ./photo.jpg <remoteFolderId>
```

Upload a directory recursively:

```bash
npm start -- upload ./Documents <remoteFolderId>
```

The CLI creates missing remote folders while uploading directories.

## Download

Download one remote file:

```bash
npm start -- download <remoteFileId> ./downloads/file.bin
```

Download a remote folder recursively:

```bash
npm start -- download <remoteFolderId> ./downloads --dir
```

## Incremental Sync

Run one upload sync pass:

```bash
npm start -- sync-upload ./local-dir <remoteFolderId> --once
```

Before uploading, `sync-upload` checks the remote folder tree. If the same relative path already exists with the same file size, it records the match and skips the upload. If duplicates already exist for that path, it keeps one same-size match and removes the extras. If the path exists only with different content size, it deletes the old remote file first and then uploads the replacement.

Keep polling for local changes:

```bash
npm start -- sync-upload ./local-dir <remoteFolderId> --interval 5000
```

Run one download sync pass:

```bash
npm start -- sync-download <remoteFolderId> ./local-dir --once
```

Keep polling for remote changes:

```bash
npm start -- sync-download <remoteFolderId> ./local-dir --interval 30000
```

Sync state is stored in `state.json` under the CLI config directory.

## Help

Show all commands:

```bash
npm start -- help
```

Or:

```bash
./cloud189 help
```

## Security Notes

Do not commit credentials, token files, downloaded private files, or `.env.local`. If you need isolated test state, set `CLOUD189_CLI_HOME` to a temporary directory.
