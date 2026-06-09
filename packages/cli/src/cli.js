const fs = require('fs');
const path = require('path');
const { createClient } = require('./client');
const { getConfigDir, getStatePath } = require('./config');
const { sessionStatus } = require('./session');
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
const { pollDownload, pollUpload, runUploadPass } = require('./sync');
const { downloadFile, downloadFolder, uploadPath } = require('./transfer');
const { simpleSyncGuard, simpleUploadGuard } = require('./upload-policy');
const { inspectTransfer } = require('./transfer-status');
const { guardBeforeUpload, cleanupRedacted } = require('./security/data-leak-guard');
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
  'upload <smallFileOrSmallDir> <remoteFolderId>',
  'upload-large-file <localFile> <remoteFolderId>',
  'upload-large-dir <localDir> <remoteFolderId>',
  'upload-safe <localPath> <remoteFolderId>',
  'download <remoteId> <localPath> [--dir]',
  'sync <smallFileOrSmallDir> <remoteFolderId>',
  'sync-large-file <localFile> <remoteFolderId> [--once]',
  'sync-large-dir <localDir> <remoteFolderId> [--once]',
  'sync-upload <localDir> <remoteFolderId> [--once] [--interval <ms>]',
  'sync-upload-safe <localDir> <remoteFolderId> [--once] [--interval <ms>]',
  'sync-download <remoteFolderId> <localDir> [--once] [--interval <ms>]',
  'transfer-status <remoteContainerId>',
  'plan <rm|mv|rename-folder|upload|sync-upload> ...',
  'init-agent <name>',
  'agent-status',
  'status',
  'logout'
];

const BOOLEAN_OPTIONS = new Set(['json', 'help', 'dir', 'once', 'force-sensitive', 'redact', 'target-dir-bundle']);

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

function formatUploadResult(item) {
  if (item.dirBundle) return `uploaded dir-bundle ${item.dirName} ${item.remoteFolderId} (${item.bundleCount} bundles, ${item.fileCount} files)`;
  if (item.split) return `uploaded split ${item.fileName} ${item.remoteFolderId} (${item.chunkCount} chunks)`;
  return `uploaded ${item.fileName} ${item.remoteFileId}`;
}

function formatTransferStatus(status) {
  const lines = [
    `transfer ${status.status}: ${status.name || status.remoteContainerId}`,
    `mode: ${status.mode}`,
    `progress: ${status.percent}% (${status.completedUnits}/${status.totalUnits} ${status.unit})`,
    `bytes: ${formatBytes(status.completedBytes)} / ${formatBytes(status.totalBytes)}`,
    `resume: ${status.resumeSupported ? 'supported' : 'unsupported'}`
  ];
  if (status.fileCount !== undefined) lines.splice(2, 0, `files: ${status.fileCount}`);
  return lines.join('\n');
}

function remoteTaskOptions(options) {
  return {
    isFolder: Boolean(options.dir),
    name: options.name,
    parentId: options.parent
  };
}

function assertExplicitLargeCommandLocalType(command, localPath) {
  if (!['upload-large-file', 'upload-large-dir', 'sync-large-file', 'sync-large-dir'].includes(command)) {
    return fs.statSync(localPath);
  }

  const stat = fs.statSync(localPath);
  const expectsFile = command.endsWith('-file');
  const expectsDir = command.endsWith('-dir');

  if (expectsFile && !stat.isFile()) {
    const error = new Error(`${command} requires a file. Use ${command.replace('-file', '-dir')} for directories.`);
    error.code = 'INVALID_LOCAL_PATH_TYPE';
    throw error;
  }

  if (expectsDir && !stat.isDirectory()) {
    const error = new Error(`${command} requires a directory. Use ${command.replace('-dir', '-file')} for files.`);
    error.code = 'INVALID_LOCAL_PATH_TYPE';
    throw error;
  }

  return stat;
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

function statusPayload(sessionInfo) {
  const statePath = getStatePath();
  const state = syncState.loadState(statePath);
  const operations = state.operations || [];
  return {
    ok: true,
    loggedIn: sessionInfo?.loggedIn ?? false,
    storage: sessionInfo?.storage || 'none',
    account: sessionInfo?.account || null,
    sessionPath: sessionInfo?.sessionPath || null,
    configDir: getConfigDir(),
    tokenCache: sessionInfo?.loggedIn ? 'encrypted' : 'missing',
    stateFile: fs.existsSync(statePath) ? statePath : 'missing',
    lastOperation: operations.length ? operations[operations.length - 1] : null
  };
}

function printStatusText(payload) {
  console.log(`Config: ${payload.configDir}`);
  console.log(`Session: ${payload.loggedIn ? 'logged in + ' + payload.storage : 'not logged in'}`);
  if (payload.loggedIn && payload.account) {
    console.log(`Account: ${payload.account}`);
  }
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

function agentStatusPayload(context, sessionInfo) {
  return {
    ok: true,
    login: sessionInfo?.loggedIn ? 'ok' : 'missing',
    storage: sessionInfo?.storage || 'none',
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
  const stdinIsTTY = process.stdin.isTTY === true;

  // -- Data Leak Guard mode selection --
  let guardMode = 'non-interactive';
  if (wantsJson) guardMode = 'non-interactive';
  else if (stdinIsTTY) guardMode = 'interactive';
  // For MCP usage (argv contains --json), guardMode stays non-interactive.

  const guardOpts = {
    mode: guardMode,
    wantsJson,
    actor: 'cli',
    onSensitive: parsed.options['on-sensitive'],
    forceSensitive: Boolean(parsed.options['force-sensitive'])
  };

  let leakGuardResult = null; // populated before upload commands

  try {
    assertCommandAllowed(parsed.command, context);

  // Helper: call Data Leak Guard before upload-type commands
  async function runGuard(localPath) {
    const result = await guardBeforeUpload(localPath, guardOpts);
    if (result.decision === 'deny') {
      const findings = result.findings || [];
      const blocked = result.blockedFiles || [];
      if (wantsJson) {
        writeJsonOutput({
          ok: false,
          blocked: true,
          reason: 'Sensitive file blocked by Data Leak Guard',
          file: localPath,
          findings,
          blockedFiles: blocked,
          actions: result.allowedActions,
          defaultAction: result.recommendedAction
        });
      } else {
        console.error('Data Leak Guard: upload denied.');
        for (const f of findings.slice(0, 10)) {
          console.error(`  [${f.severity}] ${path.basename(f.file)} — ${f.type}${f.name ? ' (' + f.name + ')' : ''}`);
        }
        process.exitCode = 1;
      }
      return null; // signal: blocked
    }
    if (result.decision === 'replace') {
      // redactedMap: originalPath → redactedPath for files that were redacted
      return { decision: 'replace', redactedMap: result.redactedMap || {}, findings: result.findings };
    }
    return { decision: 'approve', findings: result.findings };
  }

  // Helper: create a temp copy of localPath where specified files are replaced
  // with redacted versions. Returns the path to use for upload.
  async function uploadWithRedacted(localPath, redactedMap) {
    // If only some files are redacted, we need a temp directory with the full
    // tree where redacted files are swapped in.
    const fs = require('fs');
    const os = require('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-guard-'));
    const srcResolved = path.resolve(localPath);
    const stat = fs.statSync(srcResolved);

    if (stat.isFile()) {
      // Single file: use redacted copy directly
      return redactedMap[srcResolved] || srcResolved;
    }

    // Directory tree copy with selective redact
    const walkFiles = require('./fs-utils').walkFiles;
    for (const filePath of walkFiles(srcResolved)) {
      const rel = path.relative(srcResolved, filePath);
      const dest = path.join(tmpDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const redacted = redactedMap[filePath];
      if (redacted) {
        fs.copyFileSync(redacted, dest);
      } else {
        fs.copyFileSync(filePath, dest);
      }
    }
    return tmpDir;
  }

  function cleanupAllRedacted(redactedMap) {
    if (!redactedMap) return;
    for (const key of Object.keys(redactedMap)) {
      cleanupRedacted(redactedMap[key]);
    }
    // Also try to clean temp dir
    try {
      const tmpDir = path.dirname(Object.values(redactedMap)[0]);
      fs.rmSync(tmpDir, { force: true, recursive: true });
    } catch {}
  }

  if (parsed.command === 'login') {
    const username = requireArg(parsed.options.username, '--username');
    const password = requireArg(parsed.options.password, '--password');
    const client = createClient({ username, password });
    await client.getSession();
    console.log('Login successful.');
    console.log('Session stored securely.');
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
    console.log('Login successful.');
    console.log('Session stored securely.');
    return;
  }

  if (parsed.command === 'login-sso') {
    const ssonCookie = requireArg(parsed.options.cookie, '--cookie');
    const client = createClient({ ssonCookie });
    await client.getSession();
    console.log('Login successful.');
    console.log('Session stored securely.');
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

  if (parsed.command === 'upload' || parsed.command === 'upload-large-file' || parsed.command === 'upload-large-dir') {
    const localPath = requireArg(parsed.args[0], 'localPath');
    const remoteFolderId = requireArg(parsed.args[1], 'remoteFolderId');
    assertExplicitLargeCommandLocalType(parsed.command, localPath);
    const explicitLarge = parsed.command === 'upload-large-file' || parsed.command === 'upload-large-dir';
    if (parsed.command === 'upload') {
      simpleUploadGuard(localPath);
    }
    const client = createClient();
    const uploaded = await uploadPath(client, localPath, remoteFolderId, {
      forceLargeFileSplit: explicitLarge && parsed.command === 'upload-large-file',
      forceDirBundle: explicitLarge && parsed.command === 'upload-large-dir',
      useTargetAsDirBundle: Boolean(parsed.options['target-dir-bundle']),
      callbacks: {
        onProgress(progress) {
          process.stderr.write(`\rupload ${Math.round(progress)}%`);
        }
      }
    });
    process.stderr.write(uploaded.length ? '\n' : '');
    if (wantsJson) {
      writeJsonOutput({ ok: true, command: parsed.command, uploaded });
      return;
    }
    printLines(uploaded.map(formatUploadResult));
    return;
  }

  if (parsed.command === 'upload-safe') {
    const localPath = requireArg(parsed.args[0], 'localPath');
    const remoteFolderId = requireArg(parsed.args[1], 'remoteFolderId');
    assertWriteRoot(remoteFolderId, context);
    const guardResult = await runGuard(localPath);
    if (!guardResult) return; // blocked

    const client = createClient();
    const uploadSource = guardResult.decision === 'replace'
      ? await uploadWithRedacted(localPath, guardResult.redactedMap)
      : localPath;
    await assertNoUploadConflict(client, uploadSource, remoteFolderId);
    const uploaded = await uploadPath(client, uploadSource, remoteFolderId, {
      callbacks: {
        onProgress(progress) {
          process.stderr.write(`\rupload ${Math.round(progress)}%`);
        }
      }
    });
    process.stderr.write(uploaded.length ? '\n' : '');
    if (wantsJson) {
      writeJsonOutput({ ok: true, uploaded, guard: { decision: guardResult.decision, findings: guardResult.findings } });
      return;
    }
    printLines(uploaded.map(formatUploadResult));
    if (guardResult.decision === 'replace') cleanupAllRedacted(guardResult.redactedMap);
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

  if (parsed.command === 'sync' || parsed.command === 'sync-large-file' || parsed.command === 'sync-large-dir') {
    const localPath = requireArg(parsed.args[0], 'localPath');
    const remoteFolderId = requireArg(parsed.args[1], 'remoteFolderId');
    const stat = assertExplicitLargeCommandLocalType(parsed.command, localPath);
    if (parsed.command === 'sync') {
      simpleSyncGuard(localPath);
    }
    const client = createClient();
    if (stat.isFile()) {
      const uploaded = await uploadPath(client, localPath, remoteFolderId, {
        forceLargeFileSplit: parsed.command === 'sync-large-file',
        callbacks: {
          onProgress(progress) {
            process.stderr.write(`\rupload ${Math.round(progress)}%`);
          }
        }
      });
      process.stderr.write(uploaded.length ? '\n' : '');
      if (wantsJson) {
        writeJsonOutput({ ok: true, command: parsed.command, uploaded });
        return;
      }
      printLines(uploaded.map(formatUploadResult));
      return;
    }
    const result = await runUploadPass(client, localPath, remoteFolderId, undefined, {
      forceDirBundle: parsed.command === 'sync-large-dir',
      useTargetAsDirBundle: Boolean(parsed.options['target-dir-bundle'])
    });
    if (wantsJson) {
      writeJsonOutput({ ok: true, command: parsed.command, uploaded: result });
      return;
    }
    console.log(`${parsed.command} pass complete`);
    return;
  }

  if (parsed.command === 'sync-upload') {
    const localDir = requireArg(parsed.args[0], 'localDir');
    const remoteFolderId = requireArg(parsed.args[1], 'remoteFolderId');
    const client = createClient();
    await pollUpload(client, localDir, remoteFolderId, {
      once: Boolean(parsed.options.once),
      intervalMs: parsed.options.interval,
      useTargetAsDirBundle: Boolean(parsed.options['target-dir-bundle'])
    });
    console.log(parsed.options.once ? 'sync-upload pass complete' : 'sync-upload running');
    return;
  }

  if (parsed.command === 'sync-upload-safe') {
    const localDir = requireArg(parsed.args[0], 'localDir');
    const remoteFolderId = requireArg(parsed.args[1], 'remoteFolderId');
    assertWriteRoot(remoteFolderId, context);
    const guardResult = await runGuard(localDir);
    if (!guardResult) return; // blocked
    const client = createClient();
    const syncSource = guardResult.decision === 'replace'
      ? await uploadWithRedacted(localDir, guardResult.redactedMap)
      : localDir;
    const result = await runSafeUploadPass(client, syncSource, remoteFolderId);
    if (wantsJson) {
      writeJsonOutput({ ok: true, ...result, guard: { decision: guardResult.decision, findings: guardResult.findings } });
      return;
    }
    if (parsed.options.once) {
      console.log(`sync-upload-safe pass complete (${result.uploaded.length} uploaded, ${result.skipped.length} skipped)`);
      if (guardResult.decision === 'replace') cleanupAllRedacted(guardResult.redactedMap);
      return;
    }
    const intervalMs = Number(parsed.options.interval || 5000);
    console.log('sync-upload-safe running');
    setInterval(() => {
      runSafeUploadPass(client, syncSource, remoteFolderId).catch((error) => {
        console.error(`sync-upload-safe failed: ${error.message}`);
      });
    }, intervalMs);
    if (guardResult.decision === 'replace') cleanupAllRedacted(guardResult.redactedMap);
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

  if (parsed.command === 'transfer-status') {
    const remoteContainerId = requireArg(parsed.args[0], 'remoteContainerId');
    const client = createClient();
    const status = await inspectTransfer(client, remoteContainerId);
    if (wantsJson) {
      writeJsonOutput(status);
      return;
    }
    console.log(formatTransferStatus(status));
    return;
  }

  if (parsed.command === 'status') {
    const sessionInfo = await sessionStatus();
    const payload = statusPayload(sessionInfo);
    if (wantsJson) {
      writeJsonOutput(payload);
      return;
    }
    printStatusText(payload);
    return;
  }

  if (parsed.command === 'logout') {
    const { clearSession } = require('./session');
    await clearSession();
    console.log('Logged out. Local session removed.');
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
    const sessionInfo = await sessionStatus();
    const payload = agentStatusPayload(context, sessionInfo);
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
  assertExplicitLargeCommandLocalType,
  main,
  parseArgs,
  usage
};
