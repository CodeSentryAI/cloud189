#!/usr/bin/env node

const { execFileSync, execSync } = require('child_process');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const z = require('zod');

const PACKAGE_VERSION = require(path.join(__dirname, '..', 'package.json')).version;
const PERSONAL_ROOT_FOLDER_ID = '-11';

// --- helpers ----------------------------------------------------------------

function runCloud189(args, opts = {}) {
  try {
    const result = execFileSync('cloud189', [...args, '--json'], {
      timeout: 30000,
      ...opts
    });
    return JSON.parse(result.toString());
  } catch (error) {
    if (error.stdout) {
      try { return JSON.parse(error.stdout.toString()); } catch {}
    }
    const message = error.stderr ? error.stderr.toString().trim() : error.message;
    const err = new Error(message);
    err.code = 'CLOUD189_ERROR';
    throw err;
  }
}

function okResult(summary, data) {
  return { ok: true, summary, data };
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
const localPathSchema = z.string().min(1).refine((value) => {
  const resolved = path.resolve(value);
  return resolved !== '/' && resolved !== '/etc' && !resolved.startsWith('/etc/');
}, 'localPath is outside the allowed workspace');

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
  'Download a remote file or folder to a local path.',
  {
    remoteId: remoteIdSchema.describe('Remote file or folder ID'),
    localPath: localPathSchema.describe('Local destination path'),
    dir: z.boolean().optional().describe('Set to true if downloading a folder')
  },
  (args) => {
    const cmdArgs = ['download', args.remoteId, args.localPath];
    if (args.dir) cmdArgs.push('--dir');
    return runTool(() => runCloud189(cmdArgs));
  }
);

server.tool(
  'cloud189_upload_safe',
  'Upload a local file or directory into the configured agent write root without overwriting existing remote files.',
  {
    localPath: localPathSchema.describe('Existing local file or directory path'),
    remoteFolderId: remoteIdSchema.describe('Destination remote folder ID. Must equal the configured write root ID.')
  },
  (args) => runTool(() => runCloud189(['upload-safe', args.localPath, args.remoteFolderId]))
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
  (args) => runTool(() => runCloud189(['sync-upload-safe', args.localDir, args.remoteFolderId, '--once']))
);

server.tool(
  'cloud189_plan',
  'Create a dry-run plan for a dangerous operation. The plan is informational and does not execute.',
  {
    command: z.enum(['rm', 'mv', 'rename-folder', 'upload', 'sync-upload']),
    args: z.array(z.string()).describe('Arguments for the planned command')
  },
  (args) => runTool(() => runCloud189(['plan', args.command, ...args.args]))
);

// --- main -------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stdin.resume();
  const keepAlive = setInterval(() => {}, 1 << 30);
  process.stdin.on('end', () => clearInterval(keepAlive));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
