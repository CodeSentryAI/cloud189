const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { listAll } = require('./remote');
const { MANIFEST_NAME, PROGRESS_NAME } = require('./large-transfer');
const { DIR_MANIFEST_NAME, DIR_PROGRESS_NAME } = require('./directory-transfer');

async function inspectTransfer(client, remoteContainerId) {
  const listing = await listAll(client, remoteContainerId);
  const files = listing.fileListAO.fileList || [];
  const splitManifest = files.find((file) => file.name === MANIFEST_NAME);
  const splitProgress = files.find((file) => file.name === PROGRESS_NAME);
  const dirManifest = files.find((file) => file.name === DIR_MANIFEST_NAME);
  const dirProgress = files.find((file) => file.name === DIR_PROGRESS_NAME);

  if (dirManifest) {
    return summarizeDir(await readJsonFile(client, dirManifest.id), remoteContainerId, true);
  }
  if (dirProgress) {
    return summarizeDir(await readJsonFile(client, dirProgress.id), remoteContainerId, false);
  }
  if (splitManifest) {
    return summarizeSplit(await readJsonFile(client, splitManifest.id), remoteContainerId, true);
  }
  if (splitProgress) {
    return summarizeSplit(await readJsonFile(client, splitProgress.id), remoteContainerId, false);
  }

  const error = new Error('No Cloud189 transfer manifest/progress file found in this remote folder.');
  error.code = 'TRANSFER_STATUS_NOT_FOUND';
  throw error;
}

function summarizeSplit(manifest, remoteContainerId, complete) {
  const chunks = manifest.chunks || [];
  const completedUnits = complete ? Number(manifest.chunkCount || chunks.length) : Number(manifest.completedChunks || chunks.length);
  const totalUnits = Number(manifest.chunkCount || chunks.length || 0);
  const completedBytes = chunks.reduce((sum, chunk) => sum + Number(chunk.size || 0), 0);
  const totalBytes = Number(manifest.size || completedBytes || 0);
  return baseSummary({
    remoteContainerId,
    mode: 'large-file-split',
    status: complete ? 'complete' : 'in_progress',
    complete,
    name: manifest.originalName,
    completedUnits,
    totalUnits,
    completedBytes: complete ? totalBytes : completedBytes,
    totalBytes,
    unit: 'chunks'
  });
}

function summarizeDir(manifest, remoteContainerId, complete) {
  const bundles = manifest.bundles || [];
  const completedUnits = complete ? Number(manifest.bundleCount || bundles.length) : Number(manifest.completedBundles || bundles.length);
  const totalUnits = Number(manifest.bundleCount || bundles.length || 0);
  const completedBytes = bundles.reduce((sum, bundle) => sum + Number(bundle.size || 0), 0);
  const totalBytes = Number(manifest.totalSize || completedBytes || 0);
  return {
    ...baseSummary({
      remoteContainerId,
      mode: 'large-dir-bundle',
      status: complete ? 'complete' : 'in_progress',
      complete,
      name: manifest.rootName,
      completedUnits,
      totalUnits,
      completedBytes: complete ? totalBytes : completedBytes,
      totalBytes,
      unit: 'bundles'
    }),
    fileCount: manifest.fileCount || 0
  };
}

function baseSummary({ remoteContainerId, mode, status, complete, name, completedUnits, totalUnits, completedBytes, totalBytes, unit }) {
  return {
    ok: true,
    remoteContainerId,
    mode,
    status,
    complete,
    name,
    unit,
    completedUnits,
    totalUnits,
    completedBytes,
    totalBytes,
    percent: totalBytes > 0 ? Math.round((completedBytes * 10000) / totalBytes) / 100 : 0,
    resumeSupported: true
  };
}

async function readJsonFile(client, remoteFileId) {
  if (typeof client.downloadJson === 'function') {
    return client.downloadJson(remoteFileId);
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-transfer-status-'));
  const tmpPath = path.join(tmpDir, 'status.json');
  try {
    await downloadRemoteFileToPath(client, remoteFileId, tmpPath);
    return JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function downloadRemoteFileToPath(client, remoteFileId, localPath) {
  const response = await client.getFileDownloadUrl({ fileId: remoteFileId }).json();
  const url = response.fileDownloadUrl;
  if (!url) throw new Error(`No download URL returned for ${remoteFileId}`);
  fs.mkdirSync(path.dirname(path.resolve(localPath)), { recursive: true });
  await downloadUrl(url, localPath);
}

async function downloadUrl(url, localPath, redirectsLeft = 5) {
  await new Promise((resolve, reject) => {
    const transport = url.startsWith('https:') ? https : http;
    transport.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        resolve(downloadUrl(new URL(res.headers.location, url).toString(), localPath, redirectsLeft - 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        return;
      }
      const out = fs.createWriteStream(localPath);
      res.pipe(out);
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
    }).on('error', reject);
  });
}

module.exports = { inspectTransfer };
