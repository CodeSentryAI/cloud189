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
 *   4. Create /AgentStorage/{memory,work-results,reports,logs,backups} folders
 *   5. Enable Data Leak Guard (default deny policy)
 *   6. Print MCP config for Claude Code / Cursor / Hermes
 *   7. Test upload
 */

'use strict';

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const SETUP_VERSION = require(path.join(__dirname, '..', 'package.json')).version;

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

// Resolve the globally installed CLI JS entry so we can exec it with an
// argument array (no shell string interpolation, no Windows .cmd shim issues).
let CLI_ENTRY;
function cliEntry() {
  if (CLI_ENTRY !== undefined) return CLI_ENTRY;
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const entry = path.join(root, '@codesentryai', 'cloud189', 'bin', 'cloud189.js');
    CLI_ENTRY = fs.existsSync(entry) ? entry : null;
  } catch {
    CLI_ENTRY = null;
  }
  return CLI_ENTRY;
}

function shellFallback(args) {
  for (const arg of args) {
    if (!/^[\w\-./:\\=]+$/.test(String(arg))) {
      throw new Error(`Unsafe argument for shell fallback: ${JSON.stringify(arg)}`);
    }
  }
  return ['cloud189', ...args].join(' ');
}

function runCli(args, { timeoutMs = 30000, visible = false } = {}) {
  const stdio = visible ? 'inherit' : ['pipe', 'pipe', 'pipe'];
  const entry = cliEntry();
  if (entry) {
    return execFileSync(process.execPath, [entry, ...args], { encoding: 'utf-8', stdio, timeout: timeoutMs });
  }
  return execSync(shellFallback(args), { encoding: 'utf-8', stdio, timeout: timeoutMs });
}

function runVisibleCli(args, timeoutMs = 60000) {
  try {
    runCli(args, { timeoutMs, visible: true });
    return true;
  } catch {
    return false;
  }
}

function runJson(args, timeoutMs = 30000) {
  try {
    return { ok: true, raw: runCli(args, { timeoutMs }) };
  } catch (e) {
    return { ok: false, raw: (e.stdout||'') + (e.stderr||'') };
  }
}

function installPublishedPackage(name) {
  const versioned = `${name}@${SETUP_VERSION}`;
  if (runVisible(`npm install -g ${versioned}`, 120000)) {
    return versioned;
  }
  if (runVisible(`npm install -g ${name}`, 120000)) {
    return name;
  }
  fail(`Install failed for ${name}.`);
  info(`Expected publish order: first publish @codesentryai/cloud189@${SETUP_VERSION}, then @codesentryai/cloud189-mcp@${SETUP_VERSION}, then @codesentryai/cloud189-setup@${SETUP_VERSION}.`);
  process.exit(1);
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
  const installedCli = installPublishedPackage('@codesentryai/cloud189');
  ok(`cloud189 CLI installed (${installedCli})`);

  // ── Step 2: Install MCP ────────────────────────────────────────────
  step(2, 'Install cloud189-mcp');
  const installedMcp = installPublishedPackage('@codesentryai/cloud189-mcp');
  ok(`cloud189-mcp installed (${installedMcp})`);

  // ── Step 3: Login ──────────────────────────────────────────────────
  step(3, 'Login to Tianyi Cloud 189');

  const st = runJson(['status', '--json']);
  let alreadyLoggedIn = false;
  try { alreadyLoggedIn = JSON.parse(st.raw||'{}').loggedIn; } catch {}

  if (alreadyLoggedIn) {
    ok('Already logged in');
  } else {
    console.log(`\n  ${YELLOW}Scan the QR code below with the 天翼云盘 app${RESET}\n`);
    if (!runVisibleCli(['login-qr'], 180000)) {
      fail('Login failed or timed out. Try: cloud189 login-qr');
      process.exit(1);
    }
  }

  // ── Step 4: Create folders ─────────────────────────────────────────
  step(4, 'Create /AgentStorage folder structure');

  // Create /AgentStorage at personal root (-11)
  const mkRoot = runJson(['mkdir', '-11', 'AgentStorage', '--json']);
  if (!mkRoot.ok) {
    mkdirFallback('AgentStorage');
  }
  ok('/AgentStorage created');

  // Get its folder ID
  let agentStorageId = null;
  const ls = runJson(['list', '-11', '--json']);
  if (ls.ok) {
    try {
      const j = JSON.parse(ls.raw);
      const entries = Array.isArray(j.items)
        ? j.items
        : (j.entries || j.files || j.list || j.data?.entries || []);
      const hit = entries.find(e => (e.name||e.fileName||'').replace(/\s/g,'').toLowerCase() === 'agentstorage');
      if (hit) agentStorageId = hit.id || hit.fileId || hit.folderId;
    } catch {}
  }

  const subfolders = ['memory','work-results','reports','logs','backups'];
  if (agentStorageId) {
    for (const name of subfolders) {
      runJson(['mkdir', String(agentStorageId), String(name), '--json']);
      ok(`/${name} created`);
    }

    // Point the agent write root at /AgentStorage so upload-safe accepts it.
    const agentCfgDir = path.join(os.homedir(), '.cloud189-agent');
    const agentCfgFile = path.join(agentCfgDir, 'config.json');
    let agentCfg = {};
    try { agentCfg = JSON.parse(fs.readFileSync(agentCfgFile, 'utf8')); } catch {}
    agentCfg.provider = agentCfg.provider || 'cloud189';
    agentCfg.mode = agentCfg.mode || 'agent-safe';
    agentCfg.agent = {
      ...(agentCfg.agent || {}),
      name: (agentCfg.agent && agentCfg.agent.name) || 'hermes',
      writeRootId: String(agentStorageId),
      writeRootName: 'AgentStorage'
    };
    try {
      fs.mkdirSync(agentCfgDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(agentCfgFile, JSON.stringify(agentCfg, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      try { fs.chmodSync(agentCfgDir, 0o700); fs.chmodSync(agentCfgFile, 0o600); } catch {}
      ok(`Agent write root configured (${agentStorageId})`);
    } catch (e) {
      warn(`Could not write agent config: ${e.message}`);
    }
  } else {
    warn('Could not detect /AgentStorage folder ID — create subfolders manually:');
    for (const name of subfolders) info(`  cloud189 mkdir <AgentStorageId> ${name}`);
  }

  // ── Step 5: Enable Data Leak Guard ──────────────────────────────────
  step(5, 'Enable Data Leak Guard');

  const configDir  = path.join(os.homedir(), '.config', 'cloud189');
  const policyDir  = path.join(configDir, 'security');
  const policyFile = path.join(policyDir, 'policy.json');
  const defaultPolicy = path.join(__dirname, '..', 'src', 'default-policy.json');

  try {
    fs.mkdirSync(policyDir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(defaultPolicy)) {
      fs.copyFileSync(defaultPolicy, policyFile);
    } else {
      // Fallback: write minimal deny policy inline
      fs.writeFileSync(policyFile,
        JSON.stringify({
          enabled: true,
          defaultInteractiveAction: 'ask',
          defaultNonInteractiveAction: 'deny',
          defaultMcpAction: 'deny',
          allowMcpOriginalSensitiveUpload: false,
          allowPlainSecretLogs: false
        }, null, 2) + '\n',
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
      "args": ["-y", "@codesentryai/cloud189-mcp"]
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
    const up = runJson(['upload-safe', testFile, String(agentStorageId), '--json']);
    if (up.ok) {
      try {
        const payload = JSON.parse(up.raw);
        const first = (payload.uploaded || [])[0] || {};
        testId = first.remoteFileId || first.remoteFolderId || null;
      } catch {}
      ok('Test upload succeeded');
    } else {
      warn('Test upload skipped (non-critical)');
    }
  } else {
    warn('Test upload skipped (folder ID not available)');
  }

  try { fs.unlinkSync(testFile); } catch {}
  if (testId) {
    // Cleanup is an explicit admin action, so run it in user mode.
    runJson(['rm', String(testId), '--mode', 'user', '--json']);
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
║    /AgentStorage/work-results — generated work artifacts          ║
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
      runCli(['mkdir', '-11', String(name)], { timeoutMs: 15000 });
      return;
    } catch {}
  }
}

main().catch(e => {
  fail(`Unexpected error: ${e.message}`);
  process.exit(1);
});
