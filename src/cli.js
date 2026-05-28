const fs = require('fs');
const { createClient } = require('./client');
const { getConfigDir, getStatePath, getTokenPath } = require('./config');
const { formatBytes, formatEntries, formatListing } = require('./format');
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
const syncState = require('./sync-state');

const COMMANDS = [
  'login --username <name> --password <password>',
  'login-qr [--timeout <ms>] [--interval <ms>]',
  'login-sso --cookie <sson>',
  'list [remoteFolderId] (default: -11 personal root; 0: SyncDisk)',
  'roots',
  'mkdir <remoteParentId> <name>',
  'rm <remoteId> [--dir] [--name <name>] [--parent <parentId>]',
  'mv <remoteId> <targetFolderId> [--dir] [--name <name>] [--parent <parentId>]',
  'rename-folder <remoteFolderId> <newName>',
  'quota',
  'tree [remoteFolderId] [--depth <n>]',
  'search <keyword> [remoteFolderId] [--depth <n>]',
  'upload <localPath> <remoteFolderId>',
  'download <remoteId> <localPath> [--dir]',
  'sync-upload <localDir> <remoteFolderId> [--once] [--interval <ms>]',
  'sync-download <remoteFolderId> <localDir> [--once] [--interval <ms>]',
  'status'
];

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }

  return {
    command: positional[0],
    args: positional.slice(1),
    options
  };
}

function usage() {
  return `Usage: cloud189 <command> [options]\n\nCommands:\n  ${COMMANDS.join('\n  ')}`;
}

function requireArg(value, label) {
  if (!value) {
    throw new Error(`Missing required argument: ${label}`);
  }
  return value;
}

function printLines(lines) {
  console.log(lines.join('\n'));
}

function remoteTaskOptions(options) {
  return {
    isFolder: Boolean(options.dir),
    name: options.name,
    parentId: options.parent
  };
}

function parseDepth(value) {
  if (value === undefined) {
    return Infinity;
  }
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error('--depth must be a non-negative integer');
  }
  return depth;
}

function formatQuota(info) {
  const total = info.totalSize ?? info.totalCapacity ?? info.capacity ?? info.cloudCapacity;
  const used = info.usedSize ?? info.usedCapacity ?? info.used ?? info.cloudUsedSize;
  const available = info.availableSize ?? info.freeSize ?? (total !== undefined && used !== undefined ? Number(total) - Number(used) : undefined);
  const rows = [
    ['Total', total],
    ['Used', used],
    ['Available', available]
  ].filter(([, value]) => value !== undefined);

  if (!rows.length) {
    return JSON.stringify(info, null, 2);
  }

  return rows.map(([label, value]) => `${label}: ${formatBytes(value)}`).join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (!parsed.command || parsed.options.help || parsed.command === 'help') {
    console.log(usage());
    return;
  }

  if (parsed.command === 'login') {
    const username = requireArg(parsed.options.username, '--username');
    const password = requireArg(parsed.options.password, '--password');
    const client = createClient({ username, password });
    await client.getSession();
    console.log(`Login succeeded. Token cache: ${getTokenPath()}`);
    return;
  }

  if (parsed.command === 'login-qr') {
    const client = createClient({
      onQRCodeReady(qrUuid) {
        console.log('Scan this QR code URL with the Tianyi Cloud mobile app:');
        console.log(`https://open.e.189.cn/api/logbox/oauth2/image.do?uuid=${encodeURIComponent(qrUuid)}`);
        console.log(`QR UUID: ${qrUuid}`);
        console.log('Waiting for confirmation...');
      },
      qrLoginOptions: {
        timeout: parsed.options.timeout ? Number(parsed.options.timeout) : undefined,
        pollInterval: parsed.options.interval ? Number(parsed.options.interval) : undefined
      }
    });
    await client.getSession();
    console.log(`Login succeeded. Token cache: ${getTokenPath()}`);
    return;
  }

  if (parsed.command === 'login-sso') {
    const ssonCookie = requireArg(parsed.options.cookie, '--cookie');
    const client = createClient({ ssonCookie });
    await client.getSession();
    console.log(`Login succeeded. Token cache: ${getTokenPath()}`);
    return;
  }

  if (parsed.command === 'list') {
    const client = createClient();
    const listing = await listAll(client, parsed.args[0]);
    console.log(formatListing(listing));
    return;
  }

  if (parsed.command === 'roots') {
    console.log(`personal ${PERSONAL_ROOT_FOLDER_ID}`);
    console.log('syncdisk 0');
    return;
  }

  if (parsed.command === 'mkdir') {
    const remoteParentId = requireArg(parsed.args[0], 'remoteParentId');
    const name = requireArg(parsed.args[1], 'name');
    const client = createClient();
    const created = await createRemoteFolder(client, remoteParentId, name);
    console.log(`created dir ${created.id} ${created.name}`);
    return;
  }

  if (parsed.command === 'rm') {
    const remoteId = requireArg(parsed.args[0], 'remoteId');
    const client = createClient();
    const result = await deleteRemoteItem(client, remoteId, remoteTaskOptions(parsed.options));
    console.log(`delete task ${result.taskId || 'complete'} status ${result.taskStatus ?? 'unknown'}`);
    return;
  }

  if (parsed.command === 'mv') {
    const remoteId = requireArg(parsed.args[0], 'remoteId');
    const targetFolderId = requireArg(parsed.args[1], 'targetFolderId');
    const client = createClient();
    const result = await moveRemoteItem(client, remoteId, targetFolderId, remoteTaskOptions(parsed.options));
    console.log(`move task ${result.taskId || 'complete'} status ${result.taskStatus ?? 'unknown'}`);
    return;
  }

  if (parsed.command === 'rename-folder') {
    const remoteFolderId = requireArg(parsed.args[0], 'remoteFolderId');
    const newName = requireArg(parsed.args[1], 'newName');
    const client = createClient();
    await renameRemoteFolder(client, remoteFolderId, newName);
    console.log(`renamed dir ${remoteFolderId} ${newName}`);
    return;
  }

  if (parsed.command === 'quota') {
    const client = createClient();
    const info = await client.getUserSizeInfo();
    console.log(formatQuota(info));
    return;
  }

  if (parsed.command === 'tree') {
    const client = createClient();
    const entries = await collectRemoteEntries(client, parsed.args[0], {
      maxDepth: parseDepth(parsed.options.depth)
    });
    console.log(formatEntries(entries));
    return;
  }

  if (parsed.command === 'search') {
    const keyword = requireArg(parsed.args[0], 'keyword');
    const client = createClient();
    const entries = await searchRemoteEntries(client, keyword, parsed.args[1], {
      maxDepth: parseDepth(parsed.options.depth)
    });
    console.log(formatEntries(entries));
    return;
  }

  if (parsed.command === 'upload') {
    const localPath = requireArg(parsed.args[0], 'localPath');
    const remoteFolderId = requireArg(parsed.args[1], 'remoteFolderId');
    const client = createClient();
    const uploaded = await uploadPath(client, localPath, remoteFolderId, {
      callbacks: {
        onProgress(progress) {
          process.stderr.write(`\rupload ${Math.round(progress)}%`);
        }
      }
    });
    process.stderr.write(uploaded.length ? '\n' : '');
    printLines(uploaded.map((item) => `uploaded ${item.fileName} ${item.remoteFileId}`));
    return;
  }

  if (parsed.command === 'download') {
    const remoteId = requireArg(parsed.args[0], 'remoteId');
    const localPath = requireArg(parsed.args[1], 'localPath');
    const client = createClient();
    const results = parsed.options.dir
      ? await downloadFolder(client, remoteId, localPath)
      : [await downloadFile(client, remoteId, localPath)];
    printLines(results.map((item) => `downloaded ${item.remoteFileId} ${item.localPath}`));
    return;
  }

  if (parsed.command === 'sync-upload') {
    const localDir = requireArg(parsed.args[0], 'localDir');
    const remoteFolderId = requireArg(parsed.args[1], 'remoteFolderId');
    const client = createClient();
    await pollUpload(client, localDir, remoteFolderId, {
      once: Boolean(parsed.options.once),
      intervalMs: parsed.options.interval
    });
    console.log(parsed.options.once ? 'sync-upload pass complete' : 'sync-upload running');
    return;
  }

  if (parsed.command === 'sync-download') {
    const remoteFolderId = requireArg(parsed.args[0], 'remoteFolderId');
    const localDir = requireArg(parsed.args[1], 'localDir');
    const client = createClient();
    await pollDownload(client, remoteFolderId, localDir, {
      once: Boolean(parsed.options.once),
      intervalMs: parsed.options.interval
    });
    console.log(parsed.options.once ? 'sync-download pass complete' : 'sync-download running');
    return;
  }

  if (parsed.command === 'status') {
    const statePath = getStatePath();
    const state = syncState.loadState(statePath);
    const operations = state.operations || [];
    console.log(`Config: ${getConfigDir()}`);
    console.log(`Token cache: ${fs.existsSync(getTokenPath()) ? 'present' : 'missing'}`);
    console.log(`State file: ${fs.existsSync(statePath) ? statePath : 'missing'}`);
    if (operations.length) {
      const last = operations[operations.length - 1];
      console.log(`Last operation: ${last.type} at ${last.at} (${last.count} changed)`);
    } else {
      console.log('Last operation: none');
    }
    return;
  }

  throw new Error(`Unknown command: ${parsed.command}\n\n${usage()}`);
}

module.exports = {
  main,
  parseArgs,
  usage
};
