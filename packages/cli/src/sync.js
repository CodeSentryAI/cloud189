const path = require('path');
const { getStatePath } = require('./config');
const { fileSignature, relativeKey, walkFiles } = require('./fs-utils');
const {
  collectRemoteTree,
  deleteRemoteFiles,
  ensureRemoteFolderPath,
  indexRemoteFilesByPath
} = require('./remote');
const { downloadFile } = require('./transfer');
const { hasChanged, loadState, recordOperation, saveState } = require('./sync-state');

async function runUploadPass(client, localDir, remoteFolderId, statePath = getStatePath()) {
  const root = path.resolve(localDir);
  const state = loadState(statePath);
  const uploaded = [];
  const skipped = [];
  const remoteFiles = await collectRemoteTree(client, remoteFolderId);
  const remoteByPath = indexRemoteFilesByPath(remoteFiles);

  for (const filePath of walkFiles(root)) {
    const key = relativeKey(root, filePath);
    const signature = fileSignature(filePath);
    const remoteMatches = remoteByPath.get(key) || [];
    const sameSizeRemote = remoteMatches.find((file) => Number(file.size) === signature.size);

    if (sameSizeRemote) {
      await deleteRemoteFiles(client, remoteMatches.filter((file) => file.id !== sameSizeRemote.id));
      state.uploads[key] = { ...signature, remoteFileId: sameSizeRemote.id };
      skipped.push(key);
      continue;
    }

    if (!hasChanged(state.uploads[key], signature) && remoteMatches.length > 0) {
      continue;
    }

    const folderId = await ensureRemoteFolderPath(client, remoteFolderId, key.split('/').slice(0, -1));
    await deleteRemoteFiles(client, remoteMatches);
    const result = await client.upload({ parentFolderId: folderId, filePath });
    state.uploads[key] = { ...signature, remoteFileId: result.file.userFileId };
    uploaded.push(key);
  }

  recordOperation(state, { type: 'sync-upload', count: uploaded.length, skipped: skipped.length });
  saveState(statePath, state);
  return uploaded;
}

async function runDownloadPass(client, remoteFolderId, localDir, statePath = getStatePath()) {
  const state = loadState(statePath);
  const downloaded = [];
  const files = await collectRemoteTree(client, remoteFolderId);

  for (const file of files) {
    const signature = { size: file.size, rev: file.rev };
    if (!hasChanged(state.downloads[file.relativePath], signature)) {
      continue;
    }

    const localPath = path.join(localDir, ...file.relativePath.split('/'));
    await downloadFile(client, file.id, localPath);
    state.downloads[file.relativePath] = { ...signature, remoteFileId: file.id };
    downloaded.push(file.relativePath);
  }

  recordOperation(state, { type: 'sync-download', count: downloaded.length });
  saveState(statePath, state);
  return downloaded;
}

async function pollUpload(client, localDir, remoteFolderId, options = {}) {
  const intervalMs = Number(options.intervalMs || 5000);
  await runUploadPass(client, localDir, remoteFolderId, options.statePath);
  if (options.once) return;

  setInterval(() => {
    runUploadPass(client, localDir, remoteFolderId, options.statePath).catch((error) => {
      console.error(`sync-upload failed: ${error.message}`);
    });
  }, intervalMs);
}

async function pollDownload(client, remoteFolderId, localDir, options = {}) {
  const intervalMs = Number(options.intervalMs || 30000);
  await runDownloadPass(client, remoteFolderId, localDir, options.statePath);
  if (options.once) return;

  setInterval(() => {
    runDownloadPass(client, remoteFolderId, localDir, options.statePath).catch((error) => {
      console.error(`sync-download failed: ${error.message}`);
    });
  }, intervalMs);
}

module.exports = {
  pollDownload,
  pollUpload,
  runDownloadPass,
  runUploadPass
};
