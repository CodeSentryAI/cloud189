const fs = require('fs');
const { createClient } = require('./client');
const { getConfigDir, getStatePath, getTokenPath } = require('./config');
const { formatBytes, formatEntries, formatListing, table } = require('./format');
const {
  assertCommandAllowed,
  assertWriteRoot,
  errorPayload,
  loadAgentConfig,
  resolveAgentContext,
  saveAgentConfig,
  writeJsonOutput
} = require('./agent-safe');
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

const COMMANDS = [
  'login --username <name> --password <password>',
  'login-qr [--timeout <ms>] [--interval <ms>]',
  'login-sso --cookie <sson>',
  'list [remoteFolderId] (default: -11 personal root; 0: SyncDisk)',
  'roots',
  'mkdir <remoteParentId> <name>',
  'mkdir-safe <remoteParentId> <name>',
  'rm <remoteId> [--dir] [--name <name>] [--parent <parentId>]',
  'mv <remoteId> <targetFolderId> [--dir] [--name <name>] [--parent <parentId>]',
  'rename-folder <remoteFolderId> <newName>',
  'quota',
  'tree [remoteFolderId] [--depth <n>]',
  'search <keyword> [remoteFolderId] [--depth <n>]',
  'upload <localPath> <remoteFolderId>',
  'upload-safe <localPath> <remoteFolderId>',
  'download <remoteId> <localPath> [--dir]',
  'sync-upload <localDir> <remoteFolderId> [--once] [--interval <ms>]',
  'sync-upload-safe <localDir> <remoteFolderId> [--once] [--interval <ms>]',
  'sync-download <remoteFolderId> <localDir> [--once] [--interval <ms>]',
  'plan <rm|mv|rename-folder|upload|sync-upload> ...',
  'init-agent <name>',
  'agent-status',
  'status'
];

const BOOLEAN_OPTIONS = new Set(['json', 'help', 'dir', 'once']);

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
    if (BOOLEAN_OPTIONS.has(key)) {
      options[key] = true;
    } else {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        options[key] = true;
      } else {
        options[key] = next;
        index += 1;
      }
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
  const total = info.totalSize ?? info.totalCapacity ?? info.capacity ?? info.cloudCapacity ?? info.cloudCapacityInfo?.totalSize;
  const used = info.usedSize ?? info.usedCapacity ?? info.used ?? info.cloudUsedSize ?? info.cloudCapacityInfo?.usedSize;
  const available = info.availableSize ?? info.freeSize ?? info.cloudCapacityInfo?.freeSize ?? (total !== undefined && used !== undefined ? Number(total) - Number(used) : undefined);
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

function quotaPayload(info) {
  const total = info.totalSize ?? info.totalCapacity ?? info.capacity ?? info.cloudCapacity ?? info.cloudCapacityInfo?.totalSize;
  const used = info.usedSize ?? info.usedCapacity ?? info.used ?? info.cloudUsedSize ?? info.cloudCapacityInfo?.usedSize;
  const available = info.availableSize ?? info.freeSize ?? info.cloudCapacityInfo?.freeSize ?? (total !== undefined && used !== undefined ? Number(total) - Number(used) : undefined);
  return { ok: true, total, used, available, raw: info };
}

function statusPayload() {
  const statePath = getStatePath();
  const state = syncState.loadState(statePath);
  const operations = state.operations || [];
  return {
    ok: true,
    configDir: getConfigDir(),
    tokenCache: fs.existsSync(getTokenPath()) ? 'present' : 'missing',
    stateFile: fs.existsSync(statePath) ? statePath : 'missing',
    lastOperation: operations.length ? operations[operations.length - 1] : null
  };
}

function printStatusText(payload) {
  console.log(`Config: ${payload.configDir}`);
  console.log(`Token cache: ${payload.tokenCache}`);
  console.log(`State file: ${payload.stateFile}`);
  if (payload.lastOperation) {
    const last = payload.lastOperation;
    console.log(`Last operation: ${last.type} at ${last.at} (${last.count} changed)`);
  } else {
    console.log('Last operation: none');
  }
}

function formatPlan(actions) {
  return table(actions, [
    { key: 'action', header: 'ACTION' },
    { key: 'type', header: 'TYPE' },
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'NAME' },
    { key: 'risk', header: 'RISK' }
  ]);
}

async function ensureNamedFolder(client, parentId, name) {
  const listing = await listAll(client, parentId);
  const existing = listing.fileListAO.folderList.find((folder) => folder.name === name);
  if (existing) {
    return existing;
  }
  return createRemoteFolder(client, parentId, name);
}

function agentStatusPayload(context) {
  return {
    ok: true,
    login: fs.existsSync(getTokenPath()) ? 'ok' : 'missing',
    provider: context.provider,
    mode: context.mode,
    agent: context.agent.name,
    writeRootId: context.agent.writeRootId,
    canSearch: true,
    canDownload: true,
    canUploadSafe: Boolean(context.agent.writeRootId),
    canDelete: false,
    canMove: false,
    canOverwrite: false
  };
}

function formatAgentStatus(payload) {
  const rows = [
    ['login', payload.login],
    ['provider', payload.provider],
    ['mode', payload.mode],
    ['agent', payload.agent],
    ['write_root_id', payload.writeRootId || 'missing'],
    ['can_search', payload.canSearch ? 'yes' : 'no'],
    ['can_download', payload.canDownload ? 'yes' : 'no'],
    ['can_upload_safe', payload.canUploadSafe ? 'yes' : 'no'],
    ['can_delete', payload.canDelete ? 'yes' : 'no'],
    ['can_move', payload.canMove ? 'yes' : 'no'],
    ['can_overwrite', payload.canOverwrite ? 'yes' : 'no']
  ].map(([key, value]) => ({ key, value }));
  return table(rows, [
    { key: 'key', header: 'KEY' },
    { key: 'value', header: 'VALUE' }
  ]);
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (!parsed.command || parsed.options.help || parsed.command === 'help') {
    console.log(usage());
    return;
  }

  const wantsJson = Boolean(parsed.options.json);
  const context = resolveAgentContext(parsed.options);

  try {
    assertCommandAllowed(parsed.command, context);

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
    if (wantsJson) {
      writeJsonOutput({ ok: true, items: normalizeListingItems(listing, parsed.args[0] || PERSONAL_ROOT_FOLDER_ID) });
      return;
    }
    console.log(formatListing(listing));
    return;
  }

  if (parsed.command === 'roots') {
    if (wantsJson) {
      writeJsonOutput(rootsPayload());
      return;
    }
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
    if (wantsJson) {
      writeJsonOutput(quotaPayload(info));
      return;
    }
    console.log(formatQuota(info));
    return;
  }

  if (parsed.command === 'tree') {
    const client = createClient();
    const entries = await collectRemoteEntries(client, parsed.args[0], {
      maxDepth: parseDepth(parsed.options.depth)
    });
    if (wantsJson) {
      writeJsonOutput({ ok: true, items: normalizeEntries(entries) });
      return;
    }
    console.log(formatEntries(entries));
    return;
  }

  if (parsed.command === 'search') {
    const keyword = requireArg(parsed.args[0], 'keyword');
    const client = createClient();
    const entries = await searchRemoteEntries(client, keyword, parsed.args[1], {
      maxDepth: parseDepth(parsed.options.depth)
    });
    if (wantsJson) {
      writeJsonOutput({ ok: true, items: normalizeEntries(entries) });
      return;
    }
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

  if (parsed.command === 'upload-safe') {
    const localPath = requireArg(parsed.args[0], 'localPath');
    const remoteFolderId = requireArg(parsed.args[1], 'remoteFolderId');
    assertWriteRoot(remoteFolderId, context);
    const client = createClient();
    await assertNoUploadConflict(client, localPath, remoteFolderId);
    const uploaded = await uploadPath(client, localPath, remoteFolderId, {
      callbacks: {
        onProgress(progress) {
          process.stderr.write(`\rupload ${Math.round(progress)}%`);
        }
      }
    });
    process.stderr.write(uploaded.length ? '\n' : '');
    if (wantsJson) {
      writeJsonOutput({ ok: true, uploaded });
      return;
    }
    printLines(uploaded.map((item) => `uploaded ${item.fileName} ${item.remoteFileId}`));
    return;
  }

  if (parsed.command === 'mkdir-safe') {
    const remoteParentId = requireArg(parsed.args[0], 'remoteParentId');
    const name = requireArg(parsed.args[1], 'name');
    assertWriteRoot(remoteParentId, context);
    const client = createClient();
    const folder = await mkdirSafe(client, remoteParentId, name);
    if (wantsJson) {
      writeJsonOutput({ ok: true, item: { type: 'dir', id: folder.id, name: folder.name, existed: folder.existed } });
      return;
    }
    console.log(`${folder.existed ? 'existing' : 'created'} dir ${folder.id} ${folder.name}`);
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

  if (parsed.command === 'sync-upload-safe') {
    const localDir = requireArg(parsed.args[0], 'localDir');
    const remoteFolderId = requireArg(parsed.args[1], 'remoteFolderId');
    assertWriteRoot(remoteFolderId, context);
    const client = createClient();
    const result = await runSafeUploadPass(client, localDir, remoteFolderId);
    if (wantsJson) {
      writeJsonOutput({ ok: true, ...result });
      return;
    }
    if (parsed.options.once) {
      console.log(`sync-upload-safe pass complete (${result.uploaded.length} uploaded, ${result.skipped.length} skipped)`);
      return;
    }
    const intervalMs = Number(parsed.options.interval || 5000);
    console.log('sync-upload-safe running');
    setInterval(() => {
      runSafeUploadPass(client, localDir, remoteFolderId).catch((error) => {
        console.error(`sync-upload-safe failed: ${error.message}`);
      });
    }, intervalMs);
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
    const payload = statusPayload();
    if (wantsJson) {
      writeJsonOutput(payload);
      return;
    }
    printStatusText(payload);
    return;
  }

  if (parsed.command === 'plan') {
    const planCommand = requireArg(parsed.args[0], 'plan command');
    const payload = planPayload(planCommand, parsed.args.slice(1));
    if (wantsJson) {
      writeJsonOutput(payload);
      return;
    }
    console.log(payload.summary);
    console.log(`What this would do: ${payload.intent}`);
    console.log(`Potential impact: ${payload.potentialImpact}`);
    console.log(`Safe alternative: ${payload.safeAlternative}`);
    console.log('User decision required: approve or deny');
    console.log(formatPlan(payload.actions));
    return;
  }

  if (parsed.command === 'init-agent') {
    const agentName = requireArg(parsed.args[0], 'name');
    const client = createClient();
    const agents = await ensureNamedFolder(client, PERSONAL_ROOT_FOLDER_ID, 'Agents');
    const agentRoot = await ensureNamedFolder(client, agents.id, agentName);
    await ensureNamedFolder(client, agentRoot.id, 'inbox');
    await ensureNamedFolder(client, agentRoot.id, 'results');
    await ensureNamedFolder(client, agentRoot.id, 'workspace');
    await ensureNamedFolder(client, agentRoot.id, 'logs');

    const config = loadAgentConfig();
    config.mode = 'agent-safe';
    config.agent = {
      ...(config.agent || {}),
      name: agentName,
      writeRootName: agentName,
      writeRootId: agentRoot.id,
      allowDelete: false,
      allowMove: false,
      allowRename: false,
      allowOverwrite: false
    };
    saveAgentConfig(config);
    const rows = [
      { key: 'agent', value: agentName },
      { key: 'write_root', value: `/Agents/${agentName}` },
      { key: 'write_root_id', value: agentRoot.id },
      { key: 'mode', value: 'agent-safe' }
    ];
    if (wantsJson) {
      writeJsonOutput({ ok: true, agent: agentName, writeRoot: `/Agents/${agentName}`, writeRootId: agentRoot.id, mode: 'agent-safe' });
      return;
    }
    console.log(table(rows, [
      { key: 'key', header: 'KEY' },
      { key: 'value', header: 'VALUE' }
    ]));
    return;
  }

  if (parsed.command === 'agent-status') {
    const payload = agentStatusPayload(context);
    if (wantsJson) {
      writeJsonOutput(payload);
      return;
    }
    console.log(formatAgentStatus(payload));
    return;
  }

  throw new Error(`Unknown command: ${parsed.command}\n\n${usage()}`);
  } catch (error) {
    if (wantsJson) {
      writeJsonOutput(errorPayload(error));
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

module.exports = {
  main,
  parseArgs,
  usage
};
