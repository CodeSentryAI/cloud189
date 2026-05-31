# Security Architecture

## Definition

We define security concretely — not just "secure":

| Property | Meaning |
|---|---|
| **Secure** | No password stored by agent, QR login only, local session encrypted, explicit upload/download operations, no mount daemon, JSON audit logs |
| **Reliable** | Explicit operations, list-before-operate, resumable operations, retry on failure |
| **Extensible** | CLI + MCP + skills + scriptable JSON output, configurable policies |
| **Free** | Uses your own Tianyi Cloud 189 account (free tier) |

## Session Security

### What Happens at Login

1. User runs `cloud189 login-qr`
2. QR code appears in terminal
3. User scans with 天翼云盘 app
4. CLI receives session tokens
5. Tokens are encrypted with AES-256-GCM (scrypt KDF)
6. Encrypted blob saved to `~/.config/cloud189/session.enc`
7. Only output: `Login successful. Session stored securely.`

### What Is Never Stored in Plaintext

- Access tokens
- Refresh tokens
- Session keys
- Usernames or passwords
- SSO cookies

### File Permissions

| Path | Mode |
|---|---|
| `~/.config/cloud189/` | `0700` (owner only) |
| `~/.config/cloud189/session.enc` | `0600` (owner read/write only) |
| `~/.config/cloud189/device.json` | `0600` |

### Verification

```bash
# After login, verify no plaintext secrets:
grep -R "accessToken\|refreshToken\|sessionKey" ~/.config/cloud189/
# Should return nothing (session.enc is encrypted)
```

## Data Leak Guard

A pre-flight scan runs before every upload command. Agents can store artifacts, but cannot silently upload secrets.

### What It Blocks (Forbidden Paths)

- `~/.ssh/**` — SSH keys
- `~/.gnupg/**` — GPG keys
- `~/.aws/**` — AWS credentials
- `~/.kube/**` — Kubernetes configs
- `~/.hermes/.env` — Hermes secrets
- `~/.claude/**` — Claude config
- `**/.env`, `**/.env.*` — Environment files
- `**/*.pem`, `**/*.key` — Certificates and keys
- `**/id_rsa`, `**/id_ed25519` — Private keys
- `**/secrets/**`, `**/credentials/**` — Secret directories
- `**/service-account*.json` — Service account files

### What It Detects (Secret Patterns)

| Pattern | Severity |
|---|---|
| `API_KEY=xxx`, `SECRET=xxx` in env files | High |
| `Bearer xxx` tokens | High |
| `-----BEGIN PRIVATE KEY-----` | Critical |
| `AKIA...` AWS access keys | Critical |

### Policy File

Configure at `~/.config/cloud189/security/policy.json`:

```json
{
  "enabled": true,
  "defaultInteractiveAction": "ask",
  "defaultNonInteractiveAction": "deny",
  "defaultMcpAction": "deny",
  "allowMcpOriginalSensitiveUpload": false
}
```

### Agent-Safe Default

| Mode | Default Action |
|---|---|
| Interactive (human) | Ask (Approve / Deny / Replace) |
| Non-interactive (`--json`) | Deny |
| MCP / Agent | Deny |

Override with `--force-sensitive` (still logs warning).

### Audit Log

All guard decisions logged to `~/.config/cloud189/audit.log`:

```json
{"time":"2026-05-31T...","event":{"event":"upload_blocked","file":"/home/user/.env","reason":["forbidden_path"],"actor":"mcp","decision":"deny"}}
```

No raw secret values are ever written to the audit log.

## Agent-Safe Mode

| Command | Allowed? |
|---|---|
| `login`, `login-qr`, `login-sso` | Yes |
| `logout` | Yes |
| `status`, `agent-status` | Yes |
| `list`, `tree`, `search` | Yes |
| `download` | Yes |
| `upload`, `upload-safe` | Yes (Data Leak Guard protects) |
| `sync-upload`, `sync-upload-safe` | Yes (Data Leak Guard protects) |
| `mkdir`, `mkdir-safe` | Yes |
| `plan` | Yes (dry-run only) |
| `rm` | **No** |
| `mv` | **No** |
| `rename-folder` | **No** |

## What NOT To Upload

**Never:**
- Private keys (RSA, EC, Ed25519, any format)
- Seed phrases / mnemonic words
- API keys and tokens
- `.env` files
- Production database credentials
- Unencrypted customer/personal data
- Password files

**For sensitive data: encrypt before upload.**

## Logout

```bash
cloud189 logout
```

Deletes `session.enc` and `device.json`. Running `cloud189 status` afterward shows `loggedIn: false`.
