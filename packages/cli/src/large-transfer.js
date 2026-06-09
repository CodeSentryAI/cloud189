const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { createRemoteFolder, deleteRemoteFiles, listAll } = require('./remote');

const SPLIT_FOLDER_SUFFIX = '.cloud189-split';
const MANIFEST_NAME = '.cloud189-split-manifest.json';
const PROGRESS_NAME = '.cloud189-split-progress.json';
const DEFAULT_CHUNK_SIZE = 512 * 1024 * 1024;
const DEFAULT_TMP_RESERVE_BYTES = 256 * 1024 * 1024;
const MIN_CHUNK_SIZE = 8 * 1024 * 1024;

function parseBytes(value, fallback = DEFAULT_CHUNK_SIZE) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return value;
  const text = String(value).trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb|tb)?$/);
  if (!match) throw new Error(`Invalid byte size: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] || 'b';
  const multiplier = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4
  }[unit];
  return Math.floor(amount * multiplier);
}

function largeFileOptions(options = {}) {
  const chunkSize = parseBytes(options.chunkSize || process.env.CLOUD189_CHUNK_SIZE, DEFAULT_CHUNK_SIZE);
  const threshold = parseBytes(options.largeFileThreshold || process.env.CLOUD189_LARGE_FILE_THRESHOLD, 1024 * 1024 * 1024);
  const tmpReserveBytes = parseBytes(options.tmpReserveBytes || process.env.CLOUD189_TMP_RESERVE_BYTES, DEFAULT_TMP_RESERVE_BYTES);
  return { chunkSize, threshold, tmpReserveBytes };
}

function diskAvailableBytes(targetPath) {
  const probePath = fs.existsSync(targetPath) ? targetPath : path.dirname(targetPath);
  if (typeof fs.statfsSync === 'function') {
    const stat = fs.statfsSync(probePath);
    return Number(stat.bavail) * Number(stat.bsize);
  }
  return Infinity;
}

function safeChunkSizeForDirectory(tmpDir, requestedChunkSize, options = {}) {
  const reserve = options.tmpReserveBytes ?? DEFAULT_TMP_RESERVE_BYTES;
  const available = diskAvailableBytes(tmpDir);
  if (!Number.isFinite(available)) return requestedChunkSize;
  const usable = Math.max(0, available - reserve);
  if (usable < Math.min(requestedChunkSize, MIN_CHUNK_SIZE)) {
    throw new Error(`Not enough free space in temp directory ${tmpDir}: available=${available}, reserve=${reserve}, minimumChunk=${Math.min(requestedChunkSize, MIN_CHUNK_SIZE)}`);
  }
  return Math.min(requestedChunkSize, usable);
}

function isSplitFolderName(name) {
  return String(name || '').endsWith(SPLIT_FOLDER_SUFFIX);
}

function originalNameFromSplitFolder(name) {
  const text = String(name || '');
  return isSplitFolderName(text) ? text.slice(0, -SPLIT_FOLDER_SUFFIX.length) : text;
}

function splitFolderNameFor(fileName) {
  return `${fileName}${SPLIT_FOLDER_SUFFIX}`;
}


function chunkNameFor(index, sha256) {
  return `part-${String(index).padStart(6, '0')}-${sha256.slice(0, 16)}`;
}

function requestStream(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https:') ? https : http;
    const request = transport.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects > 0) {
        response.resume();
        resolve(requestStream(new URL(response.headers.location, url).toString(), redirects - 1));
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}`));
        return;
      }
      resolve(response);
    });
    request.on('error', reject);
  });
}

async function downloadRemoteFileToPath(client, remoteFileId, localPath) {
  const response = await client.getFileDownloadUrl({ fileId: remoteFileId }).json();
  const url = response.fileDownloadUrl;
  if (!url) throw new Error(`No download URL returned for ${remoteFileId}`);
  fs.mkdirSync(path.dirname(path.resolve(localPath)), { recursive: true });
  const input = await requestStream(url);
  const output = fs.createWriteStream(localPath);
  await new Promise((resolve, reject) => {
    input.pipe(output);
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
  });
}

function shouldVerifyRemoteChunks(options = {}) {
  if (options.verifyRemoteChunks !== undefined) return Boolean(options.verifyRemoteChunks);
  return String(process.env.CLOUD189_VERIFY_REMOTE_CHUNKS || '').toLowerCase() === 'true';
}

async function ensureSplitFolder(client, remoteFolderId, fileName) {
  const name = splitFolderNameFor(fileName);
  const listing = await listAll(client, remoteFolderId);
  const existing = listing.fileListAO.folderList.find((folder) => folder.name === name);
  if (existing) return { ...existing, existed: true };
  const created = await createRemoteFolder(client, remoteFolderId, name);
  return { ...created, existed: false };
}

function indexFilesByName(files) {
  const index = new Map();
  for (const file of files) {
    const bucket = index.get(file.name) || [];
    bucket.push(file);
    index.set(file.name, bucket);
  }
  return index;
}

async function remoteChunkIsReusable(client, remoteFile, expected, tmpDir, verify) {
  if (!remoteFile) return false;
  if (Number(remoteFile.size || 0) !== Number(expected.size || 0)) return false;
  if (!verify) return true;
  const verifyPath = path.join(tmpDir, `verify-${expected.name}`);
  await downloadRemoteFileToPath(client, remoteFile.id, verifyPath);
  const actual = await hashFile(verifyPath);
  fs.rmSync(verifyPath, { force: true });
  return actual === expected.sha256;
}

async function writeProgressManifest(client, splitFolderId, progress, existingProgressFiles = []) {
  const result = await uploadJsonAsFile(client, progress, PROGRESS_NAME, splitFolderId);
  if (existingProgressFiles.length) {
    await deleteRemoteFiles(client, existingProgressFiles);
    existingProgressFiles.length = 0;
  }
  existingProgressFiles.push({ id: result.file.userFileId, name: PROGRESS_NAME, parentId: splitFolderId, size: result.file.fileSize });
  return result;
}

function hashFile(filePath, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const input = fs.createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function writeChunkFromFd(fd, start, length, destination) {
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(null, { fd, start, end: start + length - 1, autoClose: false });
    const output = fs.createWriteStream(destination);
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
    input.pipe(output);
  });
}

async function uploadJsonAsFile(client, object, fileName, parentFolderId) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-manifest-'));
  const tmpPath = path.join(tmpDir, fileName);
  fs.writeFileSync(tmpPath, JSON.stringify(object, null, 2), 'utf8');
  try {
    return await client.upload({ parentFolderId, filePath: tmpPath });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function uploadLargeFileAsSplit(client, filePath, remoteFolderId, options = {}) {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  const configuredOptions = largeFileOptions(options);
  let { chunkSize } = configuredOptions;
  const fileName = path.basename(resolved);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-chunks-'));
  chunkSize = safeChunkSizeForDirectory(tmpDir, chunkSize, configuredOptions);
  const splitFolder = await ensureSplitFolder(client, remoteFolderId, fileName);
  const verifyRemote = shouldVerifyRemoteChunks(options);
  const chunks = [];
  const fd = fs.openSync(resolved, 'r');
  let reused = 0;
  let uploadedCount = 0;

  try {
    const initialListing = await listAll(client, splitFolder.id);
    const remoteByName = indexFilesByName(initialListing.fileListAO.fileList);
    const manifestFiles = initialListing.fileListAO.fileList.filter((file) => file.name === MANIFEST_NAME);
    const progressFiles = initialListing.fileListAO.fileList.filter((file) => file.name === PROGRESS_NAME);
    const totalChunks = Math.ceil(stat.size / chunkSize);

    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * chunkSize;
      const size = Math.min(chunkSize, stat.size - start);
      const scratchName = `part-${String(index).padStart(6, '0')}.tmp`;
      const scratchPath = path.join(tmpDir, scratchName);
      await writeChunkFromFd(fd, start, size, scratchPath);
      const sha256 = await hashFile(scratchPath);
      const chunkName = chunkNameFor(index, sha256);
      const finalChunkPath = path.join(tmpDir, chunkName);
      fs.renameSync(scratchPath, finalChunkPath);
      const expected = { index, name: chunkName, size, sha256 };
      const remoteCandidates = remoteByName.get(chunkName) || [];
      let reusable = null;

      for (const remoteFile of remoteCandidates) {
        if (await remoteChunkIsReusable(client, remoteFile, expected, tmpDir, verifyRemote)) {
          reusable = remoteFile;
          break;
        }
      }

      if (reusable) {
        chunks.push({ ...expected, remoteFileId: reusable.id, reused: true });
        reused += 1;
        fs.rmSync(finalChunkPath, { force: true });
      } else {
        const badCandidates = remoteCandidates.filter((file) => Number(file.size || 0) !== Number(size || 0));
        if (verifyRemote && remoteCandidates.length) {
          await deleteRemoteFiles(client, remoteCandidates);
        } else if (badCandidates.length) {
          await deleteRemoteFiles(client, badCandidates);
        }
        const result = await client.upload({ parentFolderId: splitFolder.id, filePath: finalChunkPath }, options.callbacks);
        chunks.push({ ...expected, remoteFileId: result.file.userFileId, reused: false });
        uploadedCount += 1;
        fs.rmSync(finalChunkPath, { force: true });
      }

      await writeProgressManifest(client, splitFolder.id, {
        version: 1,
        type: 'cloud189-split-progress',
        originalName: fileName,
        size: stat.size,
        chunkSize,
        chunkCount: totalChunks,
        completedChunks: chunks.length,
        chunks
      }, progressFiles);
    }

    if (manifestFiles.length) {
      await deleteRemoteFiles(client, manifestFiles);
    }
  } finally {
    fs.closeSync(fd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const manifest = {
    version: 1,
    type: 'cloud189-split-file',
    originalName: fileName,
    size: stat.size,
    chunkSize,
    chunkCount: chunks.length,
    sha256: await hashFile(resolved),
    chunks
  };
  const manifestUpload = await uploadJsonAsFile(client, manifest, MANIFEST_NAME, splitFolder.id);

  return {
    localPath: resolved,
    remoteFolderId: splitFolder.id,
    fileName,
    split: true,
    resumed: splitFolder.existed,
    reusedChunks: reused,
    uploadedChunks: uploadedCount,
    manifestRemoteFileId: manifestUpload.file.userFileId,
    chunkCount: chunks.length,
    size: stat.size
  };
}

async function maybeReadSplitManifest(client, remoteFolderId, downloadFileToPath) {
  const listing = await listAll(client, remoteFolderId);
  const manifestFile = listing.fileListAO.fileList.find((file) => file.name === MANIFEST_NAME);
  if (!manifestFile) return null;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-manifest-download-'));
  const manifestPath = path.join(tmpDir, MANIFEST_NAME);
  try {
    await downloadFileToPath(manifestFile.id, manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return { manifest, listing };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_TMP_RESERVE_BYTES,
  MANIFEST_NAME,
  PROGRESS_NAME,
  MIN_CHUNK_SIZE,
  SPLIT_FOLDER_SUFFIX,
  diskAvailableBytes,
  chunkNameFor,
  hashFile,
  isSplitFolderName,
  largeFileOptions,
  maybeReadSplitManifest,
  originalNameFromSplitFolder,
  safeChunkSizeForDirectory,
  splitFolderNameFor,
  uploadLargeFileAsSplit
};
