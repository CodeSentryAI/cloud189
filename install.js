#!/usr/bin/env node
/**
 * postinstall hook for @codesentryai/cloud189
 *
 * - On `npm install -g`: guides the user to configure their agent MCP.
 * - On `npm install` (local / sub-dep): stays quiet unless VERBOSE=1.
 * - Creates ~/.cloud189-agent/config.json if missing.
 * - Prints one-liner setup commands for Hermes, Claude Code, OpenClaw, Cursor.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const PKG_NAME = '@codesentryai/cloud189';
const PKG_DISPLAY = 'Cloud189 by CodeSentryAI';

// --- helpers ----------------------------------------------------------------

function colors() {
  const enabled = process.stdout.isTTY && !process.env.NO_COLOR;
  return {
    green:  (s) => enabled ? `\x1b[32m${s}\x1b[0m` : s,
    yellow: (s) => enabled ? `\x1b[33m${s}\x1b[0m` : s,
    cyan:   (s) => enabled ? `\x1b[36m${s}\x1b[0m` : s,
    bold:   (s) => enabled ? `\x1b[1m${s}\x1b[0m` : s,
    dim:    (s) => enabled ? `\x1b[2m${s}\x1b[0m` : s,
  };
}

const c = colors();

function pkgRoot() {
  // Works after `npm install -g` because require.resolve follows the real path
  try {
    const entry = require.resolve(PKG_NAME);
    let dir = path.dirname(entry);
    for (let i = 0; i < 3; i++) dir = path.dirname(dir);
    return dir;
  } catch {
    return null;
  }
}

function findMcpServerJs() {
  // resolution order:
  // 1. global bin → node_modules/.../src/mcp-server.js
  // 2. CWD-based local install
  // 3. this file's sibling src/mcp-server.js
  const candidates = [];
  const root = pkgRoot();
  if (root) {
    candidates.push(path.join(root, 'node_modules', PKG_NAME, 'src', 'mcp-server.js'));
  }
  candidates.push(path.resolve(__dirname, '..', 'src', 'mcp-server.js'));
  candidates.push(path.resolve(process.cwd(), 'node_modules', PKG_NAME, 'src', 'mcp-server.js'));
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const MCP_JS = findMcpServerJs();

// --- agent config dirs -------------------------------------------------------

function detectAgents() {
  const home = os.homedir();
  const agents = [];

  // Hermes
  const hermesMcpCfg = path.join(home, '.hermes', 'hermes-agent', 'config.yaml');
  const hermesSkills = path.join(home, '.hermes', 'skills');
  if (fs.existsSync(hermesMcpCfg) || fs.existsSync(hermesSkills)) {
    agents.push({
      name: 'Hermes',
      slug: 'hermes',
      mcpConfigFile: hermesMcpCfg,
      mcpConfigKey: 'mcp.servers',       // YAML key in hermes config
      skillDir: path.join(hermesSkills, 'cloud-storage', 'cloud189'),
      mcpSetupCmd:
        `hermes mcp add cloud189 --command node --args ${MCP_JS || '<pkg>/src/mcp-server.js'}`,
    });
  }

  // Claude Code (~/.claude/.mcp.json or ~/.claude.json)
  const claudeMcpJson = path.join(home, '.claude', '.mcp.json');
  const claudeJson = path.join(home, '.claude.json');
  const claudeSkills = path.join(home, '.claude', 'skills');
  if (fs.existsSync(claudeMcpJson) || fs.existsSync(claudeJson) || fs.existsSync(claudeSkills) ||
      fs.existsSync(path.join(home, '.claude'))) {
    agents.push({
      name: 'Claude Code',
      slug: 'claude-code',
      mcpConfigFile: fs.existsSync(claudeMcpJson) ? claudeMcpJson : claudeJson,
      mcpFormat: 'json',
      skillDir: path.join(claudeSkills, 'cloud189'),
      mcpJsonConfig: {
        mcpServers: {
          cloud189: {
            command: 'node',
            args: [MCP_JS || `${MCP_JS}`],
          },
        },
      },
      mcpSetupCmd:
        `Run /mcp-add in Claude Code and paste:\n    { "mcpServers": { "cloud189": { "command": "node", "args": ["${MCP_JS || '<pkg>/src/mcp-server.js'}"] } } }`,
    });
  }

  // OpenClaw (~/.openclaw/config.yaml or config.json)
  const openclawDir = path.join(home, '.openclaw');
  if (fs.existsSync(openclawDir)) {
    agents.push({
      name: 'OpenClaw',
      slug: 'openclaw',
      mcpConfigFile: path.join(openclawDir, 'config.yaml'),
      skillDir: path.join(openclawDir, 'skills', 'cloud189'),
      mcpSetupCmd:
        `Add to ~/.openclaw/config.yaml:\n    mcp:\n      servers:\n        cloud189:\n          command: node\n          args: ["${MCP_JS || '<pkg>/src/mcp-server.js'}"]`,
    });
  }

  // Cursor (~/.cursor/mcp.json)
  const cursorMcp = path.join(home, '.cursor', 'mcp.json');
  if (fs.existsSync(cursorMcp) || fs.existsSync(path.join(home, '.cursor'))) {
    agents.push({
      name: 'Cursor',
      slug: 'cursor',
      mcpConfigFile: cursorMcp,
      mcpFormat: 'json',
      mcpJsonConfig: {
        mcpServers: {
          cloud189: {
            command: 'node',
            args: [MCP_JS || '<pkg>/src/mcp-server.js'],
          },
        },
      },
      mcpSetupCmd:
        `Add to ~/.cursor/mcp.json:\n    { "mcpServers": { "cloud189": { "command": "node", "args": ["${MCP_JS || '<pkg>/src/mcp-server.js'}"] } } }`,
    });
  }

  return agents;
}

// --- skill file --------------------------------------------------------------

const SKILL_MD = `---
name: cloud189
description: "Use when the user asks to interact with Tianyi Cloud Disk (天翼云盘) via the agent-safe cloud189 CLI/MCP. Covers search, download, upload-safe, sync-upload-safe, plan mode, agent-safe rules, and write-root management."
version: 1.0.0
author: CodeSentryAI
license: MIT
metadata:
  hermes:
    tags: [cloud-storage, cloud189, tianyi, agent-safe, mcp]
    related_skills: [native-mcp, mcporter]
---

# Cloud189 — Agent-Safe Tianyi Cloud Disk

## Overview

Command-based safe cloud storage for AI agents. Remote IDs only — no mount,
no direct filesystem. Agents can search, download, upload, and sync but cannot
delete, move, rename, or overwrite remote files.

## MCP Tools (11)

| Tool | Purpose |
|---|---|
| cloud189_status | Login state, config, write root |
| cloud189_roots | Root folder IDs (personal: -11, syncdisk: 0) |
| cloud189_list | List remote folder |
| cloud189_tree | Recursive listing |
| cloud189_search | Keyword search |
| cloud189_quota | Storage usage |
| cloud189_download | Download file/folder |
| cloud189_upload_safe | Upload to write root, no overwrite |
| cloud189_mkdir_safe | Idempotent mkdir in write root |
| cloud189_sync_upload_safe | Deletion-free one-shot sync |
| cloud189_plan | Dry-run plan for dangerous ops |

## Agent-Safe Mode

**Allowed:** login, login-qr, login-sso, status, quota, roots, list, tree, search,
download, mkdir, mkdir-safe, upload-safe, sync-upload-safe, sync-download, plan

**Denied:** rm, mv, rename-folder, raw upload, raw sync-upload

Denied commands must use \`plan\` → show user → wait for **approve**.

## Write Root

All safe uploads target a configured agent write root (default: \`/Agents/hermes\`).
Config stored in \`~/.cloud189-agent/config.json\`.

## Workflow: Upload Results

1. Write result to local temp, e.g. \`/tmp/result.md\`.
2. \`cloud189_status\` → get writeRootId.
3. \`cloud189_upload_safe /tmp/result.md <writeRootId>\`.
4. On CONFLICT → inform user, do not overwrite.

## Workflow: Download & Analyse

1. \`cloud189_search "keyword"\` → get remoteId.
2. \`cloud189_download <remoteId> /tmp/file.md\`.
3. Read and analyse.

## Workflow: Safe Delete

1. \`cloud189_plan rm <remoteId>\` → get dry-run plan.
2. Show plan.intent + plan.potentialImpact to user.
3. Wait for explicit "approve".
4. Switch to \`CLOUD189_MODE=user\` and run \`cloud189 rm <remoteId>\` yourself and report.

## Common Pitfalls

- upload-safe requires writeRootId. If empty, run \`cloud189 init-agent <name>\`.
- CONFLICT stops upload — never overwrite.
- MCP tools appear only after new agent session.
- Never display tokens / passwords in conversation.
`;

function writeSkill(targetDir) {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const dest = path.join(targetDir, 'SKILL.md');
    fs.writeFileSync(dest, SKILL_MD.trimStart() + '\n', 'utf8');
    return dest;
  } catch {
    return null;
  }
}

// --- main -------------------------------------------------------------------

function main() {
  // Quiet mode for non-interactive / sub-dependency installs
  const isInteractive = process.stdout.isTTY && process.stdin.isTTY;
  if (!isInteractive && !process.env.VERBOSE && !process.env.CLOUD189_DEBUG) {
    // Still create config silently
    const agentCfgDir = path.join(os.homedir(), '.cloud189-agent');
    const agentCfgFile = path.join(agentCfgDir, 'config.json');
    if (!fs.existsSync(agentCfgFile)) {
      fs.mkdirSync(agentCfgDir, { recursive: true });
      fs.writeFileSync(agentCfgFile, JSON.stringify({
        provider: 'cloud189', mode: 'agent-safe',
        agent: { name: 'hermes', writeRootId: '', writeRootName: 'hermes',
                  allowDelete: false, allowMove: false, allowRename: false, allowOverwrite: false },
      }, null, 2) + '\n', 'utf8');
    }
    return;
  }

  const line = '─'.repeat(60);
  console.log('');
  console.log(c.green(c.bold(`${PKG_DISPLAY} installed.`)));
  console.log(c.dim(line));

  // 1. Ensure agent config exists
  const agentCfgDir = path.join(os.homedir(), '.cloud189-agent');
  const agentCfgFile = path.join(agentCfgDir, 'config.json');
  if (!fs.existsSync(agentCfgFile)) {
    fs.mkdirSync(agentCfgDir, { recursive: true });
    fs.writeFileSync(agentCfgFile, JSON.stringify({
      provider: 'cloud189',
      mode: 'agent-safe',
      agent: {
        name: 'hermes',
        writeRootId: '',
        writeRootName: 'hermes',
        allowDelete: false,
        allowMove: false,
        allowRename: false,
        allowOverwrite: false,
      },
    }, null, 2) + '\n', 'utf8');
    console.log(c.green('✓'), `Created ${c.dim(agentCfgFile)}`);
  } else {
    console.log(c.dim(' '), `Config already exists: ${c.dim(agentCfgFile)}`);
  }

  // 2. Detect agents
  const agents = detectAgents();

  if (agents.length === 0) {
    console.log('');
    console.log(c.yellow('No AI agent detected. To use Cloud189 with your agent:'));
    console.log('');
    if (!MCP_JS) {
      console.log(c.yellow('  Could not locate mcp-server.js — is the package fully installed?'));
    }
    console.log('  Generic MCP config:');
    console.log(c.cyan(JSON.stringify({
      mcpServers: {
        cloud189: {
          command: 'node',
          args: [MCP_JS || '<path-to-mcp-server.js>'],
        },
      },
    }, null, 2)));
    console.log('');
    return;
  }

  // 3. Write skills + show setup per agent
  for (const agent of agents) {
    console.log('');
    console.log(c.bold(c.cyan(`▸ ${agent.name}`)));

    // skill
    if (agent.slug === 'hermes') {
      const skillPath = writeSkill(agent.skillDir);
      if (skillPath) {
        console.log(c.green('  ✓'), `Skill → ${c.dim(skillPath)}`);
      }
    }

    // MCP setup command
    console.log(c.yellow('  MCP setup:'));
    console.log('  ' + agent.mcpSetupCmd.split('\n').join('\n  '));
  }

  console.log('');
  console.log(c.dim(line));
  console.log(c.dim('  After MCP setup, start a new agent session for tools to appear.'));
  console.log(c.dim('  Then run: cloud189 init-agent <name>'));
  console.log('');
}

main();
