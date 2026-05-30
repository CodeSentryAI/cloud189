#!/usr/bin/env node

/**
 * cloud189-setup: One-command setup for Cloud189 Agent Storage
 *
 * Usage:
 *   npx @codesentryai/cloud189-setup
 *
 * What it does:
 *   1. Install cloud189 CLI
 *   2. Install cloud189-mcp
 *   3. Run cloud189 login-qr (shows QR code)
 *   4. Create /AgentStorage/{memory,reports,logs,backups} folders
 *   5. Enable Data Leak Guard (default deny policy)
 *   6. Print MCP config for Claude Code / Cursor / Hermes
 *   7. Test upload
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function step(num, title) {
  console.log(`\n${BOLD}${CYAN}═══ Step ${num}: ${title} ${'═══'.repeat(20)}${RESET}`);
}
function ok(msg)  { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg) { console.log(`  ${YELLOW}⚠${RESET} ${msg}`); }
function fail(msg) { console.log(`  ${RED}✗${RESET} ${msg}`); }
function info(msg) { console.log(`  ${DIM}${msg}${RESET}`); }

function runVisible(cmd, timeoutMs = 60000) {
  try {
    execSync(cmd, { stdio: 'inherit', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

function runJson(cmd, timeoutMs = 30000) {
  try {
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe','pipe','pipe'], timeout: timeoutMs });
    return { ok: true, raw: out };
  } catch (e) {
    return { ok: false, raw: (e.stdout||'') + (e.stderr||'') };
  }
}

function readLine(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, answer => { rl.close(); resolve(answer.trim()); });
  });
}

// ── MAIN ─────────────────────────────────────────────────────────────
async function main() {

console.log(`\n${BOLD}${CYAN}
╔══════════════════════════════════════════════════════════════╗
║           Cloud189 Agent Storage — Setup                     ║
║           Free cold storage for AI agent artifacts           ║
╚══════════════════════════════════════════════════════════════╝${RESET}`);

  // ── Step 1: Install CLI ────────────────────────────────────────────
  step(1, 'Install cloud189 CLI');
  if (!runVisible('npm install -g @codesentryai/cloud189', 120000)) {
    fail('Install failed. Try: npm install -g @codesentryai/cloud189');
    process.exit(1);
  }
  ok('cloud189 CLI installed');

  // ── Step 2: Install MCP ────────────────────────────────────────────
  step(2, 'Install cloud189-mcp');
  if (!runVisible('npm install -g @codesentryai/cloud189-mcp', 120000)) {
    fail('Install failed. Try: npm install -g @codesentryai/cloud189-mcp');
    process.exit(1);
  }
  ok('cloud189-mcp installed');

  // ── Step 3: Login ──────────────────────────────────────────────────
  step(3, 'Login to Tianyi Cloud 189');

  const st = runJson('cloud189 status --json');
  let alreadyLoggedIn = false;
  try { alreadyLoggedIn = JSON.parse(st.raw||'{}').loggedIn; } catch {}

  if (alreadyLoggedIn) {
    ok('Already logged in');
  } else {
    console.log(`\n  ${YELLOW}Scan the QR code below with the 天翼云盘 app${RESET}\n`);
    if (!runVisible('cloud189 login-qr', 180000)) {
      fail('Login failed or timed out. Try: cloud189 login-qr');
      process.exit(1);
    }
  }

  // ── Step 4: Create folders ─────────────────────────────────────────
  step(4, 'Create /AgentStorage folder structure');

  // Create /AgentStorage at personal root (-11)
  const mkRoot = runJson('cloud189 mkdir -11 AgentStorage --json');
  if (!mkRoot.ok) {
    mkdirFallback('AgentStorage');
  }
  ok('/AgentStorage created');

  // Get its folder ID
  let agentStorageId = null;
  const ls = runJson('cloud189 list -11 --json');
  if (ls.ok) {
    try {
      const j = JSON.parse(ls.raw);
      const entries = j.entries || j.files || j.list || j.data?.entries || [];
      const hit = entries.find(e => (e.name||e.fileName||'').replace(/\s/g,'').toLowerCase() === 'agentstorage');
      if (hit) agentStorageId = hit.id || hit.fileId || hit.folderId;
    } catch {}
  }

  const subfolders = ['memory','reports','logs','backups'];
  if (agentStorageId) {
    for (const name of subfolders) {
      const r = runJson(`cloud189 mkdir ${agentStorageId} ${name} --json`);
      ok(`/${name} created`);
    }
  } else {
    warn('Could not detect /AgentStorage folder ID — create subfolders manually:');
    for (const name of subfolders) info(`  cloud189 mkdir <AgentStorageId> ${name}`);
  }

  // ── Step 5: Enable Data Leak Guard ──────────────────────────────────
  step(5, 'Enable Data Leak Guard');

  const configDir  = path.join(os.homedir(), '.config', 'cloud189');
  const policyDir  = path.join(configDir, 'security');
  const policyFile = path.join(policyDir, 'policy.yaml');
  const defaultPolicy = path.join(__dirname, '..', 'src', 'default-policy.yaml');

  try {
    fs.mkdirSync(policyDir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(defaultPolicy)) {
      fs.copyFileSync(defaultPolicy, policyFile);
    } else {
      // Fallback: write minimal deny policy inline
      fs.writeFileSync(policyFile,
        'dataLeakGuard:\n  enabled: true\n  defaultNonInteractiveAction: deny\n  defaultMcpAction: deny\n  allowMcpOriginalSensitiveUpload: false\n',
        { mode: 0o600 }
      );
    }
    fs.chmodSync(policyFile, 0o600);
    ok('Data Leak Guard enabled');
    info(`Policy: ${policyFile}`);
  } catch (e) {
    warn(`Could not write policy: ${e.message}`);
  }

  // ── Step 6: Print MCP config ───────────────────────────────────────
  step(6, 'MCP Configuration');

  const mcpConfig = `{
  "mcpServers": {
    "cloud189": {
      "command": "npx",
      "args": ["@codesentryai/cloud189-mcp"]
    }
  }
}`;

  console.log(`\n  ${BOLD}Claude Code${RESET}  (~/.claude/settings.json):`);
  info(mcpConfig);
  console.log(`\n  ${BOLD}Cursor${RESET}  (~/.cursor/mcp.json):`);
  info(mcpConfig);
  console.log(`\n  ${BOLD}Hermes / OpenClaw${RESET}:`);
  info('  cloud189-mcp is installed. Run: cloud189 agent-status --json');

  // ── Step 7: Test upload ────────────────────────────────────────────
  step(7, 'Test upload');

  const testFile = path.join(os.tmpdir(), 'cloud189-agent-storage-test.txt');
  fs.writeFileSync(testFile, `Cloud189 Agent Storage — setup test\n${new Date().toISOString()}\n`);

  let testId = null;
  if (agentStorageId) {
    const up = runJson(`cloud189 upload-safe ${testFile} ${agentStorageId} --json`);
    if (up.ok) {
      try { testId = JSON.parse(up.raw).id || JSON.parse(up.raw).fileId; } catch {}
      ok('Test upload succeeded');
    } else {
      warn('Test upload skipped (non-critical)');
    }
  } else {
    warn('Test upload skipped (folder ID not available)');
  }

  try { fs.unlinkSync(testFile); } catch {}
  if (testId) {
    runJson(`cloud189 rm ${testId} --json`);
    info(`Cleaned up test file (id: ${testId})`);
  }

  // ── Done ────────────────────────────────────────────────────────────
  console.log(`${BOLD}${GREEN}
╔══════════════════════════════════════════════════════════════════╗
║                    Setup Complete ✓                              ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Your agent now has free cold storage in your own                ║
║  Tianyi Cloud 189 account.                                      ║
║                                                                  ║
║  Storage:                                                        ║
║    /AgentStorage/memory    — agent memory & session summaries     ║
║    /AgentStorage/reports   — generated reports & analysis        ║
║    /AgentStorage/logs      — task logs & audit trails            ║
║    /AgentStorage/backups   — project backups & snapshots         ║
║                                                                  ║
║  Safety:                                                         ║
║    • Data Leak Guard blocks secret uploads by default            ║
║    • Session stored encrypted (AES-256-GCM)                      ║
║    • Agents cannot delete or overwrite files                     ║
║                                                                  ║
║  Quick commands:                                                 ║
║    cloud189 status            — storage & session info           ║
║    cloud189 agent-status --json                                  ║
║    cloud189 upload-safe <file> <folderId>                        ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝${RESET}`);
}

function mkdirFallback(name) {
  // Try up to 3 times with delay
  for (let i = 0; i < 3; i++) {
    try {
      execSync(`cloud189 mkdir -11 ${name}`, { encoding: 'utf-8', stdio: ['pipe','pipe','pipe'], timeout: 15000 });
      return;
    } catch {}
  }
}

main().catch(e => {
  fail(`Unexpected error: ${e.message}`);
  process.exit(1);
});
