#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const z = require('zod');
const { createClient } = require('./client');
const { getConfigDir, getStatePath, getTokenPath } = require('./config');
const { formatBytes } = require('./format');
const {
  assertWriteRoot,
  errorPayload,
  resolveAgentContext
} = require('./agent-safe');
const {
  collectRemoteEntries,
  listAll,
  PERSONAL_ROOT_FOLDER_ID,
  searchRemoteEntries
} = require('./remote');
const { downloadFile, downloadFolder, uploadPath } = require('./transfer');
const {
  assertNoUploadConflict,
  mkdirSafe,
  normalizeEntries,
  normalizeListingItems,
  planPayload,
  rootsPayload,
  runSafeUploadPass
} = require('./safe-storage');
const syncState = require('./sync-state');

const remoteIdSchema = z.string().regex(/^-?\d+$/, 'remote IDs must be numeric strings');
const localPathSchema = z.string().min(1).refine((value) => {
  const resolved = path.resolve(value);
  return resolved !== '/' && resolved !== '/etc' && !resolved.startsWith('/etc/');
}, 'localPath is outside the allowed workspace');

const server = new McpServer(
  {
    name: 'cloud189',
    version: require('../package.json').version
  },
  {
    capabilities: { tools: {} }
  }
);

function jsonResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function jsonError(error) {
  return { content: [{ type: 'text', text: JSON.stringify(errorPayload(error), null, 2) }], isError: true };
}

function agentContext() {
  return resolveAgentContext({ mode: process.env.CLOUD189_MODE || 'agent-safe' });
}

function statusPayload() {
  const statePath = getStatePath();
  const state = syncState.loadState(statePath);
  const operations = state.operations || [];
  return {
    ok: true,
    summary: 'Status loaded.',
    data: {
      configDir: getConfigDir(),
      tokenCache: fs.existsSync(getTokenPath()) ? 'present' : 'missing',
      stateFile: fs.existsSync(statePath) ? statePath : 'missing',
      lastOperation: operations.length ? operations[operations.length - 1] : null,
      mode: agentContext().mode,
      writeRootId: agentContext().agent.writeRootId
    }
  };
}

async function runTool(fn) {
  try {
    return jsonResult(await fn());
  } catch (error) {
    return jsonError(error);
  }
}

server.tool(
  'cloud189_status',
  'Show safe storage status, login cache state, and configured agent write root.',
  {},
  async () => runTool(async () => statusPayload())
);

server.tool(
  'cloud189_roots',
  'Show built-in root folder IDs.',
  {},
  async () => runTool(async () => ({
    ok: true,
    summary: 'Loaded root IDs.',
    data: { items: rootsPayload().items }
  }))
);

server.tool(
  'cloud189_list',
  'List files and folders in a remote folder.',
  {
    folderId: remoteIdSchema.optional().describe(`Remote folder ID. Default is personal root (${PERSONAL_ROOT_FOLDER_ID}).`)
  },
  async (args) => runTool(async () => {
    const client = createClient();
    const listing = await listAll(client, args.folderId);
    return {
      ok: true,
      summary: `Listed ${listing.fileListAO.count} items.`,
      data: { items: normalizeListingItems(listing, args.folderId || PERSONAL_ROOT_FOLDER_ID) }
    };
  })
);

server.tool(
  'cloud189_tree',
  'Recursively list remote content.',
  {
    folderId: remoteIdSchema.optional().describe(`Folder ID. Default is personal root (${PERSONAL_ROOT_FOLDER_ID}).`),
    depth: z.number().int().min(0).optional().describe('Maximum depth (default: unlimited)')
  },
  async (args) => runTool(async () => {
    const client = createClient();
    const entries = await collectRemoteEntries(client, args.folderId, {
      maxDepth: args.depth ?? Infinity
    });
    return {
      ok: true,
      summary: `Loaded ${entries.length} entries.`,
      data: { items: normalizeEntries(entries) }
    };
  })
);

server.tool(
  'cloud189_search',
  'Search remote files and folders by keyword.',
  {
    keyword: z.string().min(1).describe('Search keyword'),
    folderId: remoteIdSchema.optional().describe(`Folder ID to search under. Default is personal root (${PERSONAL_ROOT_FOLDER_ID}).`),
    depth: z.number().int().min(0).optional().describe('Maximum depth (default: unlimited)')
  },
  async (args) => runTool(async () => {
    const client = createClient();
    const entries = await searchRemoteEntries(client, args.keyword, args.folderId, {
      maxDepth: args.depth ?? Infinity
    });
    return {
      ok: true,
      summary: `Found ${entries.length} entries.`,
      data: { items: normalizeEntries(entries) }
    };
  })
);

server.tool(
  'cloud189_download',
  'Download a remote file or folder to a local path.',
  {
    remoteId: remoteIdSchema.describe('Remote file or folder ID'),
    localPath: localPathSchema.describe('Local destination path'),
    dir: z.boolean().optional().describe('Set to true if downloading a folder')
  },
  async (args) => runTool(async () => {
    const client = createClient();
    const results = args.dir
      ? await downloadFolder(client, args.remoteId, args.localPath)
      : [await downloadFile(client, args.remoteId, args.localPath)];
    return {
      ok: true,
      summary: `Downloaded ${results.length} item${results.length === 1 ? '' : 's'}.`,
      data: { results }
    };
  })
);

server.tool(
  'cloud189_upload_safe',
  'Upload a local file or directory into the configured agent write root without overwriting existing remote files.',
  {
    localPath: localPathSchema.describe('Existing local file or directory path'),
    remoteFolderId: remoteIdSchema.describe('Destination remote folder ID. Must equal the configured write root ID.')
  },
  async (args) => runTool(async () => {
    if (!fs.existsSync(path.resolve(args.localPath))) {
      const error = new Error(`localPath does not exist: ${args.localPath}`);
      error.code = 'LOCAL_PATH_NOT_FOUND';
      throw error;
    }
    const context = agentContext();
    assertWriteRoot(args.remoteFolderId, context);
    const client = createClient();
    await assertNoUploadConflict(client, args.localPath, args.remoteFolderId);
    const uploaded = await uploadPath(client, args.localPath, args.remoteFolderId);
    return {
      ok: true,
      summary: `Uploaded ${uploaded.length} item${uploaded.length === 1 ? '' : 's'}.`,
      data: { uploaded }
    };
  })
);

server.tool(
  'cloud189_mkdir_safe',
  'Create a folder directly inside the configured agent write root. Existing folders are reused.',
  {
    remoteParentId: remoteIdSchema.describe('Parent folder ID. Must equal the configured write root ID.'),
    name: z.string().min(1).describe('New folder name')
  },
  async (args) => runTool(async () => {
    const context = agentContext();
    assertWriteRoot(args.remoteParentId, context);
    const client = createClient();
    const folder = await mkdirSafe(client, args.remoteParentId, args.name);
    return {
      ok: true,
      summary: folder.existed ? 'Folder already existed.' : 'Folder created.',
      data: { folder }
    };
  })
);

server.tool(
  'cloud189_sync_upload_safe',
  'Run a deletion-free one-shot upload sync into the configured agent write root.',
  {
    localDir: localPathSchema.describe('Existing local directory to sync'),
    remoteFolderId: remoteIdSchema.describe('Destination remote folder ID. Must equal the configured write root ID.')
  },
  async (args) => runTool(async () => {
    if (!fs.statSync(path.resolve(args.localDir)).isDirectory()) {
      const error = new Error(`localDir is not a directory: ${args.localDir}`);
      error.code = 'LOCAL_PATH_NOT_DIRECTORY';
      throw error;
    }
    const context = agentContext();
    assertWriteRoot(args.remoteFolderId, context);
    const client = createClient();
    const result = await runSafeUploadPass(client, args.localDir, args.remoteFolderId);
    return {
      ok: true,
      summary: `Safe sync uploaded ${result.uploaded.length} file${result.uploaded.length === 1 ? '' : 's'}.`,
      data: result
    };
  })
);

server.tool(
  'cloud189_plan',
  'Create a dry-run plan for a dangerous operation. The plan is informational and does not execute.',
  {
    command: z.enum(['rm', 'mv', 'rename-folder', 'upload', 'sync-upload']),
    args: z.array(z.string()).describe('Arguments for the planned command')
  },
  async (args) => runTool(async () => {
    const plan = planPayload(args.command, args.args);
    return {
      ...plan,
      data: {
        dryRun: true,
        planMode: true,
        requiresUserDecision: true,
        actions: plan.actions,
        userChoices: plan.userChoices
      }
    };
  })
);

server.tool(
  'cloud189_quota',
  'Show account storage usage.',
  {},
  async () => runTool(async () => {
    const client = createClient();
    const info = await client.getUserSizeInfo();
    const total = info.totalSize ?? info.totalCapacity ?? info.capacity ?? info.cloudCapacity ?? info.cloudCapacityInfo?.totalSize;
    const used = info.usedSize ?? info.usedCapacity ?? info.used ?? info.cloudUsedSize ?? info.cloudCapacityInfo?.usedSize;
    const available = info.availableSize ?? info.freeSize ?? info.cloudCapacityInfo?.freeSize ?? (total !== undefined && used !== undefined ? Number(total) - Number(used) : undefined);
    return {
      ok: true,
      summary: `Used ${formatBytes(used || 0)} of ${formatBytes(total || 0)}.`,
      data: { total, used, available, raw: info }
    };
  })
);

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
