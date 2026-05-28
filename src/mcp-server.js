#!/usr/bin/env node

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const z = require('zod');
const fs = require('fs');
const { createClient } = require('./client');
const { getConfigDir, getStatePath, getTokenPath } = require('./config');
const {
  collectRemoteEntries,
  createRemoteFolder,
  deleteRemoteItem,
  listAll,
  moveRemoteItem,
  PERSONAL_ROOT_FOLDER_ID,
  renameRemoteFolder,
  searchRemoteEntries
} = require('./remote');
const { pollDownload, pollUpload } = require('./sync');
const { downloadFile, downloadFolder, uploadPath } = require('./transfer');
const { formatListing, formatEntries, formatBytes } = require('./format');
const syncState = require('./sync-state');

const server = new McpServer(
  {
    name: 'cloud189',
    version: require('../package.json').version
  },
  {
    capabilities: { tools: {} }
  }
);

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

server.tool(
  'cloud189_login',
  'Login to Tianyi Cloud Disk with username and password.',
  {
    username: z.string().describe('Phone number or email'),
    password: z.string().describe('Password')
  },
  async (args) => {
    try {
      const client = createClient({ username: args.username, password: args.password });
      await client.getSession();
      return textResult(`Login succeeded. Token cache: ${getTokenPath()}`);
    } catch (error) {
      return errorResult(`Login failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_login_qr',
  'Login by scanning a QR code with the Tianyi Cloud mobile app. Blocks until scanned or timed out.',
  {
    timeout: z.number().optional().describe('Timeout in milliseconds (default: 120000)'),
    interval: z.number().optional().describe('Polling interval in milliseconds (default: 3000)')
  },
  async (args) => {
    try {
      let qrUrl = '';
      const client = createClient({
        onQRCodeReady(qrUuid) {
          qrUrl = `https://open.e.189.cn/api/logbox/oauth2/image.do?uuid=${encodeURIComponent(qrUuid)}`;
        },
        qrLoginOptions: {
          timeout: args.timeout ?? 120000,
          pollInterval: args.interval ?? 3000
        }
      });
      await client.getSession();
      return textResult(`Login succeeded. Token cache: ${getTokenPath()}`);
    } catch (error) {
      return errorResult(`QR login failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_login_sso',
  'Login using an existing SSON browser cookie.',
  {
    cookie: z.string().describe('SSON cookie value')
  },
  async (args) => {
    try {
      const client = createClient({ ssonCookie: args.cookie });
      await client.getSession();
      return textResult(`Login succeeded. Token cache: ${getTokenPath()}`);
    } catch (error) {
      return errorResult(`SSO login failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_list',
  'List files and folders in a remote folder.',
  {
    folderId: z.string().optional().describe(`Remote folder ID. Default is personal root (${PERSONAL_ROOT_FOLDER_ID}). Use 0 for SyncDisk.`)
  },
  async (args) => {
    try {
      const client = createClient();
      const listing = await listAll(client, args.folderId);
      return textResult(formatListing(listing));
    } catch (error) {
      return errorResult(`List failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_roots',
  'Show built-in root folder IDs.',
  {},
  async () => {
    return textResult(`personal ${PERSONAL_ROOT_FOLDER_ID}\nsyncdisk 0`);
  }
);

server.tool(
  'cloud189_mkdir',
  'Create a remote folder.',
  {
    parentId: z.string().describe('Parent folder ID'),
    name: z.string().describe('New folder name')
  },
  async (args) => {
    try {
      const client = createClient();
      const created = await createRemoteFolder(client, args.parentId, args.name);
      return textResult(`Created dir ${created.id} ${created.name}`);
    } catch (error) {
      return errorResult(`mkdir failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_rm',
  'Delete a remote file or folder.',
  {
    remoteId: z.string().describe('Remote file or folder ID'),
    dir: z.boolean().optional().describe('Set to true if deleting a folder'),
    name: z.string().optional().describe('Name of the item'),
    parentId: z.string().optional().describe('Parent folder ID')
  },
  async (args) => {
    try {
      const client = createClient();
      const result = await deleteRemoteItem(client, args.remoteId, {
        isFolder: Boolean(args.dir),
        name: args.name,
        parentId: args.parentId
      });
      return textResult(`Delete task ${result.taskId || 'complete'} status ${result.taskStatus ?? 'unknown'}`);
    } catch (error) {
      return errorResult(`rm failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_mv',
  'Move a remote file or folder to another folder.',
  {
    remoteId: z.string().describe('Remote file or folder ID'),
    targetFolderId: z.string().describe('Destination folder ID'),
    dir: z.boolean().optional().describe('Set to true if moving a folder'),
    name: z.string().optional().describe('Name of the item'),
    parentId: z.string().optional().describe('Source parent folder ID')
  },
  async (args) => {
    try {
      const client = createClient();
      const result = await moveRemoteItem(client, args.remoteId, args.targetFolderId, {
        isFolder: Boolean(args.dir),
        name: args.name,
        parentId: args.parentId
      });
      return textResult(`Move task ${result.taskId || 'complete'} status ${result.taskStatus ?? 'unknown'}`);
    } catch (error) {
      return errorResult(`mv failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_rename_folder',
  'Rename a remote folder.',
  {
    folderId: z.string().describe('Folder ID to rename'),
    newName: z.string().describe('New name')
  },
  async (args) => {
    try {
      const client = createClient();
      await renameRemoteFolder(client, args.folderId, args.newName);
      return textResult(`Renamed dir ${args.folderId} to ${args.newName}`);
    } catch (error) {
      return errorResult(`rename failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_quota',
  'Show account storage usage.',
  {},
  async () => {
    try {
      const client = createClient();
      const info = await client.getUserSizeInfo();
      const total = info.totalSize ?? info.totalCapacity ?? info.capacity ?? info.cloudCapacity;
      const used = info.usedSize ?? info.usedCapacity ?? info.used ?? info.cloudUsedSize;
      const available = info.availableSize ?? info.freeSize ?? (total !== undefined && used !== undefined ? Number(total) - Number(used) : undefined);
      const lines = [];
      if (total !== undefined) lines.push(`Total: ${formatBytes(total)}`);
      if (used !== undefined) lines.push(`Used: ${formatBytes(used)}`);
      if (available !== undefined) lines.push(`Available: ${formatBytes(available)}`);
      if (!lines.length) lines.push(JSON.stringify(info, null, 2));
      return textResult(lines.join('\n'));
    } catch (error) {
      return errorResult(`quota failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_tree',
  'Recursively list remote content.',
  {
    folderId: z.string().optional().describe(`Folder ID. Default is personal root (${PERSONAL_ROOT_FOLDER_ID}).`),
    depth: z.number().optional().describe('Maximum depth (default: unlimited)')
  },
  async (args) => {
    try {
      const client = createClient();
      const entries = await collectRemoteEntries(client, args.folderId, {
        maxDepth: args.depth ?? Infinity
      });
      return textResult(formatEntries(entries));
    } catch (error) {
      return errorResult(`tree failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_search',
  'Search remote files and folders by keyword.',
  {
    keyword: z.string().describe('Search keyword'),
    folderId: z.string().optional().describe(`Folder ID to search under. Default is personal root (${PERSONAL_ROOT_FOLDER_ID}).`),
    depth: z.number().optional().describe('Maximum depth (default: unlimited)')
  },
  async (args) => {
    try {
      const client = createClient();
      const entries = await searchRemoteEntries(client, args.keyword, args.folderId, {
        maxDepth: args.depth ?? Infinity
      });
      return textResult(formatEntries(entries));
    } catch (error) {
      return errorResult(`search failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_upload',
  'Upload a local file or directory to a remote folder.',
  {
    localPath: z.string().describe('Local file or directory path'),
    remoteFolderId: z.string().describe('Destination remote folder ID')
  },
  async (args) => {
    try {
      const client = createClient();
      const uploaded = await uploadPath(client, args.localPath, args.remoteFolderId, {
        callbacks: {
          onProgress(progress) {
            // Progress is not streamed back in MCP; just ignore
          }
        }
      });
      return textResult(uploaded.map((item) => `uploaded ${item.fileName} ${item.remoteFileId}`).join('\n'));
    } catch (error) {
      return errorResult(`upload failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_download',
  'Download a remote file or folder.',
  {
    remoteId: z.string().describe('Remote file or folder ID'),
    localPath: z.string().describe('Local destination path'),
    dir: z.boolean().optional().describe('Set to true if downloading a folder')
  },
  async (args) => {
    try {
      const client = createClient();
      const results = args.dir
        ? await downloadFolder(client, args.remoteId, args.localPath)
        : [await downloadFile(client, args.remoteId, args.localPath)];
      return textResult(results.map((item) => `downloaded ${item.remoteFileId} ${item.localPath}`).join('\n'));
    } catch (error) {
      return errorResult(`download failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_sync_upload',
  'Run a one-shot incremental upload sync. Compares local files against remote and only uploads changes.',
  {
    localDir: z.string().describe('Local directory to sync'),
    remoteFolderId: z.string().describe('Remote folder ID to sync to')
  },
  async (args) => {
    try {
      const client = createClient();
      const uploaded = await pollUpload(client, args.localDir, args.remoteFolderId, { once: true });
      return textResult('sync-upload pass complete');
    } catch (error) {
      return errorResult(`sync-upload failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_sync_download',
  'Run a one-shot incremental download sync. Compares remote files against local and only downloads changes.',
  {
    remoteFolderId: z.string().describe('Remote folder ID to sync from'),
    localDir: z.string().describe('Local directory to sync to')
  },
  async (args) => {
    try {
      const client = createClient();
      const downloaded = await pollDownload(client, args.remoteFolderId, args.localDir, { once: true });
      return textResult('sync-download pass complete');
    } catch (error) {
      return errorResult(`sync-download failed: ${error.message}`);
    }
  }
);

server.tool(
  'cloud189_status',
  'Show config path, token cache status, state file status, and last sync operation.',
  {},
  async () => {
    try {
      const statePath = getStatePath();
      const state = syncState.loadState(statePath);
      const operations = state.operations || [];
      const lines = [
        `Config: ${getConfigDir()}`,
        `Token cache: ${fs.existsSync(getTokenPath()) ? 'present' : 'missing'}`,
        `State file: ${fs.existsSync(statePath) ? statePath : 'missing'}`
      ];
      if (operations.length) {
        const last = operations[operations.length - 1];
        lines.push(`Last operation: ${last.type} at ${last.at} (${last.count} changed)`);
      } else {
        lines.push('Last operation: none');
      }
      return textResult(lines.join('\n'));
    } catch (error) {
      return errorResult(`status failed: ${error.message}`);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
