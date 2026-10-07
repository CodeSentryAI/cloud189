const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureRemoteFolderPath, listAll } = require('./remote');
const { relativeKey, safeRemoteName, walkFiles } = require('./fs-utils');
const { downloadUrlToFile, fetchDownloadUrl, requestStream } = require('./http-utils');
const {
  MANIFEST_NAME,
  assertTmpSpace,
  isSplitFolderName,
  largeFileOptions,
  hashFile,
  maybeReadSplitManifest,
  originalNameFromSplitFolder,
  uploadLargeFileAsSplit
} = require('./large-transfer');
const {
  downloadDirectoryBundle,
  isDirBundleFolderName,
  originalNameFromDirBundle,
  shouldBundleDirectory,
  uploadDirectoryAsBundle
} = require('./directory-transfer');

async function uploadPath(client, localPath, remoteFolderId, options = {}) {
  const stat = fs.statSync(localPath);
  const { threshold } = largeFileOptions(options);
  if (stat.isFile()) {
    if (options.forceLargeFileSplit || stat.size > threshold) {
      return [await uploadLargeFileAsSplit(client, localPath, remoteFolderId, options)];
    }
    const result = await client.upload({ parentFolderId: remoteFolderId, filePath: localPath }, options.callbacks);
    return [{ localPath, remoteFileId: result.file.userFileId, fileName: result.file.fileName }];
  }

  if (options.forceDirBundle || shouldBundleDirectory(localPath, options)) {
    return [await uploadDirectoryAsBundle(client, localPath, remoteFolderId, options)];
  }

  const root = path.resolve(localPath);
  const uploaded = [];
  for (const filePath of walkFiles(root)) {
    const fileStat = fs.statSync(filePath);
    const relative = relativeKey(root, filePath);
    const folderParts = relative.split('/').slice(0, -1);
    const targetFolderId = await ensureRemoteFolderPath(client, remoteFolderId, folderParts);
    if (fileStat.size > threshold) {
      uploaded.push(await uploadLargeFileAsSplit(client, filePath, targetFolderId, options));
      continue;
    }
    const result = await client.upload({ parentFolderId: targetFolderId, filePath }, options.callbacks);
    uploaded.push({ localPath: filePath, remoteFileId: result.file.userFileId, fileName: result.file.fileName });
  }
  return uploaded;
}

async function downloadFileToPath(client, remoteFileId, localPath) {
  const url = await fetchDownloadUrl(client, remoteFileId);
  await downloadUrlToFile(url, localPath);
  return { remoteFileId, localPath };
}

function filenameFromContentDisposition(header) {
  if (!header) return null;
  const utf8 = String(header).match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) return decodeURIComponent(utf8[1]);
  const plain = String(header).match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : null;
}

function targetPathForDownload(localPath, remoteName) {
  const resolved = path.resolve(localPath);
  const looksLikeDirectory = (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory())
    || localPath === '.'
    || localPath === '..'
    || localPath.endsWith(path.sep);
  if (looksLikeDirectory) {
    return path.join(resolved, remoteName);
  }
  return localPath;
}

async function downloadFile(client, remoteFileId, localPath, options = {}) {
  const response = await client.getFileDownloadUrl({ fileId: remoteFileId }).json();
  const url = response.fileDownloadUrl;
  if (!url) {
    throw new Error(`No download URL returned for ${remoteFileId}`);
  }

  const input = await requestStream(url);
  let remoteName = options.remoteName
    || filenameFromContentDisposition(input.headers['content-disposition'])
    || String(remoteFileId);
  try {
    remoteName = safeRemoteName(remoteName, 'download filename');
  } catch {
    remoteName = safeRemoteName(String(remoteFileId), 'download filename');
  }
  const targetPath = targetPathForDownload(localPath, remoteName);

  fs.mkdirSync(path.dirname(path.resolve(targetPath)), { recursive: true });
  const output = fs.createWriteStream(targetPath);

  await new Promise((resolve, reject) => {
    input.pipe(output);
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
  });

  return { remoteFileId, localPath: targetPath };
}

async function downloadSplitFolder(client, remoteFolderId, localDir, splitFolderName, options = {}) {
  const read = await maybeReadSplitManifest(
    client,
    remoteFolderId,
    (remoteFileId, targetPath) => downloadFileToPath(client, remoteFileId, targetPath)
  );
  if (!read) return null;

  const { manifest, listing } = read;
  if (manifest.type !== 'cloud189-split-file') return null;

  fs.mkdirSync(localDir, { recursive: true });
  const outputName = safeRemoteName(
    manifest.originalName || originalNameFromSplitFolder(splitFolderName),
    'split original filename'
  );
  const outputPath = path.join(localDir, outputName);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-join-'));
  const configuredOptions = largeFileOptions(options);
  assertTmpSpace(tmpDir, manifest.chunkSize || configuredOptions.chunkSize, configuredOptions);
  const output = fs.createWriteStream(outputPath);

  try {
    const filesByName = new Map(listing.fileListAO.fileList.map((file) => [file.name, file]));
    for (const chunk of [...manifest.chunks].sort((a, b) => a.index - b.index)) {
      const chunkName = safeRemoteName(chunk.name, 'split chunk name');
      const remoteChunk = filesByName.get(chunkName);
      if (!remoteChunk) throw new Error(`Missing split chunk: ${chunkName}`);
      const chunkPath = path.join(tmpDir, chunkName);
      await downloadFileToPath(client, remoteChunk.id, chunkPath);
      if (chunk.sha256) {
        const actual = await hashFile(chunkPath);
        if (actual !== chunk.sha256) throw new Error(`Checksum mismatch for split chunk: ${chunkName}`);
      }
      await new Promise((resolve, reject) => {
        const input = fs.createReadStream(chunkPath);
        input.on('error', reject);
        output.on('error', reject);
        input.on('end', resolve);
        input.pipe(output, { end: false });
      });
    }
  } finally {
    await new Promise((resolve) => output.end(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return [{ remoteFileId: remoteFolderId, localPath: outputPath, split: true, chunkCount: manifest.chunkCount }];
}

async function downloadFolder(client, remoteFolderId, localDir, options = {}) {
  const dirBundleResults = await downloadDirectoryBundle(
    client,
    remoteFolderId,
    localDir,
    options.remoteName,
    (remoteFileId, targetPath) => downloadFileToPath(client, remoteFileId, targetPath),
    options
  );
  if (dirBundleResults) return dirBundleResults;

  const splitResults = await downloadSplitFolder(client, remoteFolderId, localDir, options.remoteName, options);
  if (splitResults) return splitResults;

  const downloaded = [];
  fs.mkdirSync(localDir, { recursive: true });
  const listing = await listAll(client, remoteFolderId);

  for (const folder of listing.fileListAO.folderList) {
    const folderName = safeRemoteName(folder.name, 'remote folder name');
    if (isSplitFolderName(folderName)) {
      const childResults = await downloadFolder(client, folder.id, localDir, { remoteName: folderName });
      downloaded.push(...childResults);
      continue;
    }
    const childDir = path.join(localDir, folderName);
    const childResults = await downloadFolder(client, folder.id, childDir, { remoteName: folderName });
    downloaded.push(...childResults);
  }

  for (const file of listing.fileListAO.fileList) {
    if (file.name === MANIFEST_NAME) continue;
    const fileName = safeRemoteName(file.name, 'remote file name');
    const localPath = path.join(localDir, fileName);
    downloaded.push(await downloadFile(client, file.id, localPath, { remoteName: fileName }));
  }

  return downloaded;
}

module.exports = {
  downloadFile,
  downloadFolder,
  uploadPath
};
