#!/usr/bin/env node

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const z = require('zod');

const PACKAGE_VERSION = require(path.join(__dirname, '..', 'package.json')).version;
const PERSONAL_ROOT_FOLDER_ID = '-11';

// Windows compatibility patch: resolve the cloud189 CLI as a JS entry executed by
// the current Node binary, because spawn('cloud189') cannot resolve the .cmd shim.
function resolveCliEntry() {
  try {
    return path.join(
      path.dirname(require.resolve('@codesentryai/cloud189/package.json')),
      'bin',
      'cloud189.js'
    );
  } catch (error) {
    throw new Error(
      'Cannot locate the @codesentryai/cloud189 CLI. Install it with: npm install -g @codesentryai/cloud189'
    );
  }
}

const CLOUD189_CLI_JS = resolveCliEntry();

// --- helpers ----------------------------------------------------------------

// Custom patch: Tianyi Cloud binds the sessionKey to the login egress IP.
// On dual-stack networks Node may prefer IPv6 while login used IPv4,
// causing HTTP 400 "InvalidSessionKey - check ip error".
// Force IPv4-first explicitly for every CLI child process (not reliant on env).
const DNS_ARGS = ['--dns-result-order=ipv4first'];

// Quick commands get a bounded timeout so a hung API call cannot wedge the
// server; transfers may legitimately run much longer and get their own budget.
// Both are overridable via env for unusual networks.
function envTimeout(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

const DEFAULT_TIMEOUT_MS = envTimeout('CLOUD189_MCP_TIMEOUT_MS', 30 * 60 * 1000);
const TRANSFER_TIMEOUT_MS = envTimeout('CLOUD189_MCP_TRANSFER_TIMEOUT_MS', 12 * 60 * 60 * 1000);

async function runCloud189(args, opts = {}) {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [...DNS_ARGS, CLOUD189_CLI_JS, ...args, '--json', '--guard-mode', 'mcp'],
      {
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        ...opts
      }
    );
    return JSON.parse(stdout.toString());
  } catch (error) {
    if (error.stdout) {
      try { return JSON.parse(error.stdout.toString()); } catch {}
    }
    let message = error.stderr ? error.stderr.toString().trim() : error.message;
    if (error.killed && !message) {
      message = `cloud189 CLI timed out after ${opts.timeout || DEFAULT_TIMEOUT_MS}ms`;
    }
    const err = new Error(message);
    err.code = 'CLOUD189_ERROR';
    throw err;
  }
}

function errorResult(error) {
  return {
    ok: false,
    error: {
      code: error.code || 'CLOUD189_ERROR',
      message: error.message,
      ...(error.suggestion ? { suggestion: error.suggestion } : {})
    }
  };
}

// --- server -----------------------------------------------------------------

const server = new McpServer(
  {
    name: 'cloud189',
    version: PACKAGE_VERSION
  },
  {
    capabilities: { tools: {} }
  }
);

function jsonResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function jsonError(error) {
  return { content: [{ type: 'text', text: JSON.stringify(errorResult(error), null, 2) }], isError: true };
}

function runTool(fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(jsonResult).catch(jsonError);
    }
    return jsonResult(result);
  } catch (error) {
    return jsonError(error);
  }
}

// --- schemas ----------------------------------------------------------------

const remoteIdSchema = z.string().regex(/^-?\d+$/, 'remote IDs must be numeric strings');

// Uploads only read local files, so the coarse system-path guard is enough.
const localPathSchema = z.string().min(1).refine((value) => {
  const resolved = path.resolve(value);
  return resolved !== '/' && resolved !== '/etc' && !resolved.startsWith('/etc/');
}, 'localPath is outside the allowed workspace');

// Downloads write local files, so they are restricted to an explicit workspace
// (default: the OS temp dir and ~/cloud189; override with CLOUD189_MCP_WORKSPACE).
function realpathIfExists(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

function mcpWorkspaceRoots() {
  const configured = process.env.CLOUD189_MCP_WORKSPACE;
  if (configured) {
    return configured
      .split(path.delimiter)
      .filter(Boolean)
      .map((entry) => resolveDestination(path.resolve(entry)));
  }
  const roots = [path.resolve(os.tmpdir()), path.resolve(os.homedir(), 'cloud189')];
  if (fs.existsSync('/tmp')) roots.push('/tmp');
  return roots.map(resolveDestination);
}

// Resolve a not-yet-existing destination through its nearest existing ancestor
// so symlinks inside the workspace cannot redirect writes outside it.
function resolveDestination(value) {
  let current = path.resolve(value);
  const missing = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    missing.unshift(path.basename(current));
    current = parent;
  }
  return path.join(realpathIfExists(current), ...missing);
}

function isInsideWorkspace(value) {
  const resolved = resolveDestination(value);
  return mcpWorkspaceRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

const downloadPathSchema = z.string().min(1).refine(
  isInsideWorkspace,
  'localPath must be inside the MCP download workspace. Set CLOUD189_MCP_WORKSPACE to add allowed roots (default: OS temp dir and ~/cloud189).'
);

// --- tools ------------------------------------------------------------------

server.tool(
  'cloud189_status',
  'Show safe storage status: login state, config dir, write root, token cache.',
  {},
  () => runTool(() => runCloud189(['status']))
);

server.tool(
  'cloud189_roots',
  'Show built-in root folder IDs.',
  {},
  () => runTool(() => runCloud189(['roots']))
);

server.tool(
  'cloud189_quota',
  'Show account storage usage (total/used/available).',
  {},
  () => runTool(() => runCloud189(['quota']))
);

server.tool(
  'cloud189_list',
  'List files and folders in a remote folder.',
  {
    folderId: remoteIdSchema
      .optional()
      .describe(`Remote folder ID. Default is personal root (${PERSONAL_ROOT_FOLDER_ID}).`)
  },
  (args) => runTool(() => runCloud189(['list', args.folderId || PERSONAL_ROOT_FOLDER_ID]))
);

server.tool(
  'cloud189_tree',
  'Recursively list remote content.',
  {
    folderId: remoteIdSchema
      .optional()
      .describe(`Folder ID. Default is personal root (${PERSONAL_ROOT_FOLDER_ID}).`),
    depth: z.number().int().min(0).optional().describe('Maximum depth (default: unlimited)')
  },
  (args) => {
    const cmdArgs = ['tree', args.folderId || PERSONAL_ROOT_FOLDER_ID];
    if (args.depth !== undefined) cmdArgs.push('--depth', String(args.depth));
    return runTool(() => runCloud189(cmdArgs));
  }
);

server.tool(
  'cloud189_search',
  'Search remote files and folders by keyword.',
  {
    keyword: z.string().min(1).describe('Search keyword'),
    folderId: remoteIdSchema
      .optional()
      .describe(`Folder ID to search under. Default is personal root (${PERSONAL_ROOT_FOLDER_ID}).`),
    depth: z.number().int().min(0).optional().describe('Maximum depth (default: unlimited)')
  },
  (args) => {
    const cmdArgs = ['search', args.keyword, args.folderId || PERSONAL_ROOT_FOLDER_ID];
    if (args.depth !== undefined) cmdArgs.push('--depth', String(args.depth));
    return runTool(() => runCloud189(cmdArgs));
  }
);

server.tool(
  'cloud189_download',
  'Download a remote file or folder to a local path inside the MCP workspace.',
  {
    remoteId: remoteIdSchema.describe('Remote file or folder ID'),
    localPath: downloadPathSchema.describe('Local destination path (inside the MCP workspace)'),
    dir: z.boolean().optional().describe('Set to true if downloading a folder')
  },
  (args) => {
    const cmdArgs = ['download', args.remoteId, args.localPath];
    if (args.dir) cmdArgs.push('--dir');
    return runTool(() => runCloud189(cmdArgs, { timeout: TRANSFER_TIMEOUT_MS }));
  }
);

server.tool(
  'cloud189_upload_safe',
  'Upload a local file or directory into the configured agent write root without overwriting existing remote files.',
  {
    localPath: localPathSchema.describe('Existing local file or directory path'),
    remoteFolderId: remoteIdSchema.describe('Destination remote folder ID. Must equal the configured write root ID.')
  },
  (args) => runTool(() => runCloud189(['upload-safe', args.localPath, args.remoteFolderId], { timeout: TRANSFER_TIMEOUT_MS }))
);

server.tool(
  'cloud189_mkdir_safe',
  'Create a folder directly inside the configured agent write root. Existing folders are reused.',
  {
    remoteParentId: remoteIdSchema.describe('Parent folder ID. Must equal the configured write root ID.'),
    name: z.string().min(1).describe('New folder name')
  },
  (args) => runTool(() => runCloud189(['mkdir-safe', args.remoteParentId, args.name]))
);

server.tool(
  'cloud189_sync_upload_safe',
  'Run a deletion-free one-shot upload sync into the configured agent write root.',
  {
    localDir: localPathSchema.describe('Existing local directory to sync'),
    remoteFolderId: remoteIdSchema.describe('Destination remote folder ID. Must equal the configured write root ID.')
  },
  (args) => runTool(() => runCloud189(['sync-upload-safe', args.localDir, args.remoteFolderId, '--once'], { timeout: TRANSFER_TIMEOUT_MS }))
);

server.tool(
  'cloud189_plan',
  'Create a dry-run plan for a dangerous operation. The plan is informational and does not execute.',
  {
    command: z.enum(['rm', 'mv', 'rename-folder', 'rename-file', 'upload', 'sync-upload']),
    args: z.array(z.string()).describe('Arguments for the planned command')
  },
  (args) => runTool(() => runCloud189(['plan', args.command, ...args.args]))
);

// --- custom patch: destructive + rename tools -------------------------------

function assertConfirmed(confirm, action) {
  if (confirm !== true) {
    const err = new Error(
      `Refused to ${action} because confirm is not true. First call cloud189_plan to preview, then re-run with confirm: true.`
    );
    err.code = 'CONFIRM_REQUIRED';
    throw err;
  }
}

server.tool(
  'cloud189_rename_folder',
  'Rename a remote folder.',
  {
    remoteFolderId: remoteIdSchema.describe('Remote folder ID'),
    newName: z.string().min(1).describe('New folder name'),
    confirm: z.boolean().optional().describe('Must be true to execute')
  },
  (args) =>
    runTool(() => {
      assertConfirmed(args.confirm, 'rename folder');
      return runCloud189(['rename-folder', args.remoteFolderId, args.newName]);
    })
);

server.tool(
  'cloud189_rename_file',
  'Rename a remote file (custom patch, uses the official renameFile API).',
  {
    remoteFileId: remoteIdSchema.describe('Remote file ID'),
    newName: z.string().min(1).describe('New file name (including extension)'),
    confirm: z.boolean().optional().describe('Must be true to execute')
  },
  (args) =>
    runTool(() => {
      assertConfirmed(args.confirm, 'rename file');
      return runCloud189(['rename-file', args.remoteFileId, args.newName]);
    })
);

server.tool(
  'cloud189_rm',
  'Delete a remote file or folder. DANGEROUS. Use cloud189_plan first to preview.',
  {
    remoteId: remoteIdSchema.describe('Remote file or folder ID'),
    dir: z.boolean().optional().describe('Set to true if deleting a folder'),
    name: z.string().optional().describe('Remote item name (recommended, used for audit)'),
    parent: remoteIdSchema.optional().describe('Parent folder ID (recommended, used for audit)'),
    confirm: z.boolean().optional().describe('Must be true to execute')
  },
  (args) =>
    runTool(() => {
      assertConfirmed(args.confirm, 'delete');
      const cmdArgs = ['rm', args.remoteId];
      if (args.dir) cmdArgs.push('--dir');
      if (args.name) cmdArgs.push('--name', args.name);
      if (args.parent) cmdArgs.push('--parent', args.parent);
      return runCloud189(cmdArgs);
    })
);

server.tool(
  'cloud189_mv',
  'Move a remote file or folder to another folder. DANGEROUS. Use cloud189_plan first to preview.',
  {
    remoteId: remoteIdSchema.describe('Remote file or folder ID'),
    targetFolderId: remoteIdSchema.describe('Destination folder ID'),
    dir: z.boolean().optional().describe('Set to true if moving a folder'),
    name: z.string().optional().describe('Remote item name (recommended, used for audit)'),
    parent: remoteIdSchema.optional().describe('Current parent folder ID (recommended, used for audit)'),
    confirm: z.boolean().optional().describe('Must be true to execute')
  },
  (args) =>
    runTool(() => {
      assertConfirmed(args.confirm, 'move');
      const cmdArgs = ['mv', args.remoteId, args.targetFolderId];
      if (args.dir) cmdArgs.push('--dir');
      if (args.name) cmdArgs.push('--name', args.name);
      if (args.parent) cmdArgs.push('--parent', args.parent);
      return runCloud189(cmdArgs);
    })
);

// --- main -------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stdin.resume();
  const keepAlive = setInterval(() => {}, 1 << 30);
  process.stdin.on('end', () => clearInterval(keepAlive));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { server };
