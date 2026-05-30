# Session Security

## Overview

Cloud189 stores login sessions locally after QR/password/SSO login.
Plaintext token files are never written to disk.

## Storage Layout

```
~/.config/cloud189/          # chmod 700
├── device.json              # chmod 600 — machine-specific encryption key material
├── session.enc              # chmod 600 — AES-256-GCM encrypted session
└── config.json              # chmod 600 — general config (non-secret)
```

## Encryption

- **KDF:** scrypt (N=16384, r=8, p=1)
- **Cipher:** AES-256-GCM
- **Salt:** 32 random bytes per encryption
- **IV:** 12 random bytes
- **Auth tag:** 16 bytes (GCM built-in)

Each `save()` produces a different ciphertext (random salt + IV).

## Key Management

**Priority order:**

1. `CLOUD189_SESSION_PASSPHRASE` env var (for headless VPS automation)
2. `~/.config/cloud189/device.json` machine key (auto-generated on first login)
3. Interactive passphrase prompt (fallback)

**Design:** The keychain stores the encryption key, not the session itself.
This allows stable session file format and easy backup/migration.

## What Is Never Stored in Plaintext

- Access tokens
- Refresh tokens  
- Session keys
- Usernames/passwords
- SSO cookies
- Account identifiers (masked in status output)

## Verification

After logging in, verify no plaintext secrets on disk:

```bash
grep -R "accessToken\|refreshToken\|sessionKey" ~/.config/cloud189/
# Should return nothing (session.enc is encrypted)
```

## MCP Safety

MCP tools never see session tokens:

- `cloud189_status` → `{ loggedIn: true/false, storage: "..." }`
- `cloud189_login_qr` → `Login successful.`
- `cloud189_get_session` → **NOT EXISTING** (forbidden)

## Logout

```bash
cloud189 logout
```

Deletes `session.enc`. Running `cloud189 status` afterward shows `logged in: false`.

## Environment Variables

| Variable | Purpose |
|---|---|
| `CLOUD189_HOME` | Override config directory (default: `~/.config/cloud189`) |
| `CLOUD189_SESSION_PASSPHRASE` | Non-interactive passphrase for headless VPS |
