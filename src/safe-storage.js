const fs = require('fs');
const path = require('path');
const { fileSignature, relativeKey, walkFiles } = require('./fs-utils');
const {
  collectRemoteTree,
  createRemoteFolder,
  ensureRemoteFolderPath,
  listAll,
  PERSONAL_ROOT_FOLDER_ID
} = require('./remote');

function itemModified(item) {
  return item.lastOpTime || item.createDate || item.modifyDate || item.rev || '';
}

function remoteSignature(item) {
  if (!item) return null;
  return {
    remoteId: item.id,
    remoteModified: itemModified(item),
    remoteSize: Number(item.size || 0)
  };
}

function normalizeListingItems(listing, parentId) {
  const folders = listing.fileListAO.folderList.map((item) => ({
    type: 'dir',
    id: item.id,
    name: item.name,
    size: null,
    modified: itemModified(item),
    parentId: item.parentId || parentId
  }));
  const files = listing.fileListAO.fileList.map((item) => ({
    type: 'file',
    id: item.id,
    name: item.name,
    size: Number(item.size || 0),
    modified: itemModified(item),
    parentId: item.parentId || parentId
  }));
  return [...folders, ...files];
}

function normalizeEntries(entries) {
  return entries.map((item) => ({
    type: item.type,
    id: item.id,
    name: item.name,
    path: item.path || item.name,
    size: item.type === 'file' ? Number(item.size || 0) : null,
    modified: itemModified(item),
    parentId: item.parentId || null
  }));
}

function rootsPayload() {
  return {
    ok: true,
    items: [
      { type: 'root', id: PERSONAL_ROOT_FOLDER_ID, name: 'personal' },
      { type: 'root', id: '0', name: 'syncdisk' }
    ]
  };
}

function basenameConflictError(name) {
  const error = new Error('remote file already exists. upload-safe refused to overwrite.');
  error.code = 'CONFLICT';
  error.name = name;
  return error;
}

async function assertNoUploadConflict(client, localPath, remoteFolderId) {
  const root = path.resolve(localPath);
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    const listing = await listAll(client, remoteFolderId);
    const name = path.basename(root);
    if (listing.fileListAO.fileList.some((item) => item.name === name)) {
      throw basenameConflictError(name);
    }
    return;
  }

  const remoteFiles = await collectRemoteTree(client, remoteFolderId);
  const remoteNames = new Set(remoteFiles.map((item) => item.relativePath));
  for (const filePath of walkFiles(root)) {
    const key = relativeKey(root, filePath);
    if (remoteNames.has(key)) {
      throw basenameConflictError(key);
    }
  }
}

async function mkdirSafe(client, remoteParentId, name) {
  const listing = await listAll(client, remoteParentId);
  const existing = listing.fileListAO.folderList.find((folder) => folder.name === name);
  if (existing) {
    return { ...existing, existed: true };
  }
  const created = await createRemoteFolder(client, remoteParentId, name);
  return { ...created, existed: false };
}

function safeSyncStatePath(localDir) {
  return path.join(path.resolve(localDir), '.cloud189-sync.json');
}

function loadSafeSyncState(localDir) {
  const statePath = safeSyncStatePath(localDir);
  if (!fs.existsSync(statePath)) {
    return { remoteFolderId: '', lastSyncAt: '', files: {} };
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function saveSafeSyncState(localDir, state) {
  fs.writeFileSync(safeSyncStatePath(localDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function remoteUnchanged(previous, current) {
  if (!previous) return false;
  if (previous.remoteModified === '' && previous.remoteId === current.remoteId) {
    return Number(previous.remoteSize || 0) === Number(current.remoteSize || 0);
  }
  return previous.remoteId === current.remoteId
    && String(previous.remoteModified || '') === String(current.remoteModified || '')
    && Number(previous.remoteSize || 0) === Number(current.remoteSize || 0);
}

async function runSafeUploadPass(client, localDir, remoteFolderId) {
  const root = path.resolve(localDir);
  const state = loadSafeSyncState(root);
  const remoteFiles = await collectRemoteTree(client, remoteFolderId);
  const remoteByPath = new Map(remoteFiles.map((file) => [file.relativePath, file]));
  const uploaded = [];
  const skipped = [];
  const conflicts = [];
  const nextFiles = {};

  for (const filePath of walkFiles(root)) {
    if (path.resolve(filePath) === safeSyncStatePath(root)) {
      continue;
    }

    const key = relativeKey(root, filePath);
    const localSignature = fileSignature(filePath);
    const remote = remoteByPath.get(key);
    const currentRemote = remoteSignature(remote);
    const previous = state.files[key];

    if (!remote) {
      const folderId = await ensureRemoteFolderPath(client, remoteFolderId, key.split('/').slice(0, -1));
      const result = await client.upload({ parentFolderId: folderId, filePath });
      uploaded.push(key);
      nextFiles[key] = {
        remoteId: result.file.userFileId,
        localMtimeMs: localSignature.mtimeMs,
        localSize: localSignature.size,
        remoteModified: '',
        remoteSize: localSignature.size
      };
      continue;
    }

    if (!previous) {
      if (Number(remote.size || 0) === Number(localSignature.size || 0)) {
        skipped.push(key);
        nextFiles[key] = {
          ...currentRemote,
          localMtimeMs: localSignature.mtimeMs,
          localSize: localSignature.size
        };
        continue;
      }
      conflicts.push({ path: key, remoteId: remote.id, reason: 'remote exists without local sync state' });
      continue;
    }

    if (previous && !remoteUnchanged(previous, currentRemote)) {
      conflicts.push({ path: key, remoteId: remote.id, reason: 'remote changed since last sync' });
      nextFiles[key] = previous;
      continue;
    }

    if (previous && previous.localMtimeMs === localSignature.mtimeMs && previous.localSize === localSignature.size) {
      skipped.push(key);
      nextFiles[key] = { ...previous, ...currentRemote };
      continue;
    }

    const folderId = await ensureRemoteFolderPath(client, remoteFolderId, key.split('/').slice(0, -1));
    const result = await client.upload({ parentFolderId: folderId, filePath });
    uploaded.push(key);
    nextFiles[key] = {
      remoteId: result.file.userFileId,
      localMtimeMs: localSignature.mtimeMs,
      localSize: localSignature.size,
      remoteModified: '',
      remoteSize: localSignature.size
    };
  }

  if (conflicts.length) {
    const error = new Error('sync-upload-safe stopped because remote files changed.');
    error.code = 'CONFLICT';
    error.conflicts = conflicts;
    throw error;
  }

  state.remoteFolderId = remoteFolderId;
  state.lastSyncAt = new Date().toISOString();
  state.files = nextFiles;
  saveSafeSyncState(root, state);
  return { uploaded, skipped, conflicts };
}

function planActions(command, args) {
  if (command === 'rm') {
    return [{ action: 'delete', type: 'unknown', id: args[0], name: args[0], risk: 'requires-confirm' }];
  }
  if (command === 'mv') {
    return [{ action: 'move', type: 'unknown', id: args[0], name: args[0], targetFolderId: args[1], risk: 'requires-confirm' }];
  }
  if (command === 'rename-folder') {
    return [{ action: 'rename', type: 'dir', id: args[0], name: args[1], risk: 'requires-confirm' }];
  }
  if (command === 'upload') {
    return [{ action: 'upload', type: 'local', id: `local:${args[0]}`, name: path.basename(args[0] || ''), targetFolderId: args[1], risk: 'safe-unless-conflict' }];
  }
  if (command === 'sync-upload') {
    return [{ action: 'sync-upload', type: 'local-dir', id: `local:${args[0]}`, name: path.basename(args[0] || ''), targetFolderId: args[1], risk: 'requires-confirm' }];
  }
  const error = new Error(`Unsupported plan command: ${command}`);
  error.code = 'UNKNOWN_PLAN';
  throw error;
}

function planDescription(command, args) {
  if (command === 'rm') {
    return {
      intent: `PLAN MODE: delete remote item ${args[0]}.`,
      potentialImpact: 'This may permanently remove cloud data or make it unavailable from Cloud189.',
      safeAlternative: 'Prefer leaving the item untouched unless the user explicitly approves deletion.'
    };
  }
  if (command === 'mv') {
    return {
      intent: `PLAN MODE: move remote item ${args[0]} to folder ${args[1]}.`,
      potentialImpact: 'This changes the remote organization and may break saved remoteId/path assumptions.',
      safeAlternative: 'Prefer copying/downloading for review, or ask the user to move it manually.'
    };
  }
  if (command === 'rename-folder') {
    return {
      intent: `PLAN MODE: rename remote folder ${args[0]} to ${args[1]}.`,
      potentialImpact: 'This changes a shared folder name and may confuse users or automations that expect the old name.',
      safeAlternative: 'Prefer creating a new safe folder and uploading new outputs there.'
    };
  }
  if (command === 'upload') {
    return {
      intent: `PLAN MODE: upload ${args[0]} to remote folder ${args[1]}.`,
      potentialImpact: 'Raw upload may overwrite or conflict with existing remote files depending on Cloud189 behavior.',
      safeAlternative: 'Use upload-safe to refuse same-name conflicts automatically.'
    };
  }
  if (command === 'sync-upload') {
    return {
      intent: `PLAN MODE: raw sync-upload ${args[0]} to remote folder ${args[1]}.`,
      potentialImpact: 'Raw sync-upload may delete duplicate remote files or replace changed remote files.',
      safeAlternative: 'Use sync-upload-safe for deletion-free, conflict-stopping sync.'
    };
  }
  planActions(command, args);
  return {};
}

function planPayload(command, args) {
  const actions = planActions(command, args);
  const description = planDescription(command, args);
  return {
    ok: true,
    dryRun: true,
    planMode: true,
    requiresUserDecision: true,
    summary: 'PLAN MODE: review this dangerous operation before any execution.',
    command,
    args,
    ...description,
    actions,
    userChoices: ['approve', 'deny']
  };
}

module.exports = {
  assertNoUploadConflict,
  mkdirSafe,
  normalizeEntries,
  normalizeListingItems,
  planActions,
  planPayload,
  rootsPayload,
  runSafeUploadPass,
  safeSyncStatePath
};
