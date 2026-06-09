const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRemoteFolder, deleteRemoteFiles, listAll } = require('./remote');
const { relativeKey, walkFiles } = require('./fs-utils');
const {
  DEFAULT_TMP_RESERVE_BYTES,
  hashFile,
  largeFileOptions,
  safeChunkSizeForDirectory
} = require('./large-transfer');

const DIR_FOLDER_SUFFIX = '.cloud189-dir';
const DIR_MANIFEST_NAME = '.cloud189-dir-manifest.json';
const DIR_PROGRESS_NAME = '.cloud189-dir-progress.json';
const BUNDLES_DIR = 'bundles';
const DEFAULT_DIR_FILE_COUNT_THRESHOLD = 1000;
const DEFAULT_BUNDLE_SIZE = 512 * 1024 * 1024;

function parseBytes(value, fallback = DEFAULT_BUNDLE_SIZE) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return value;
  const text = String(value).trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb|tb)?$/);
  if (!match) throw new Error(`Invalid byte size: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] || 'b';
  const multiplier = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 }[unit];
  return Math.floor(amount * multiplier);
}

function dirBundleOptions(options = {}) {
  return {
    fileCountThreshold: Number(options.dirBundleFileCountThreshold || process.env.CLOUD189_DIR_BUNDLE_FILE_COUNT || DEFAULT_DIR_FILE_COUNT_THRESHOLD),
    bundleSize: parseBytes(options.dirBundleSize || process.env.CLOUD189_DIR_BUNDLE_SIZE, DEFAULT_BUNDLE_SIZE),
    tmpReserveBytes: parseBytes(options.tmpReserveBytes || process.env.CLOUD189_TMP_RESERVE_BYTES, DEFAULT_TMP_RESERVE_BYTES),
    verifyRemoteBundles: Boolean(options.verifyRemoteBundles) || String(process.env.CLOUD189_VERIFY_REMOTE_BUNDLES || '').toLowerCase() === 'true'
  };
}

function isDirBundleFolderName(name) {
  return String(name || '').endsWith(DIR_FOLDER_SUFFIX);
}

function originalNameFromDirBundle(name) {
  const text = String(name || '');
  return isDirBundleFolderName(text) ? text.slice(0, -DIR_FOLDER_SUFFIX.length) : text;
}

function dirBundleFolderNameFor(dirName) {
  return `${dirName}${DIR_FOLDER_SUFFIX}`;
}

function directoryInventory(localDir) {
  const root = path.resolve(localDir);
  const files = walkFiles(root).sort().map((filePath) => {
    const stat = fs.statSync(filePath);
    return {
      path: relativeKey(root, filePath),
      absolutePath: filePath,
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs)
    };
  });
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  return { root, rootName: path.basename(root), files, totalSize };
}

function shouldBundleDirectory(localDir, options = {}) {
  const opts = dirBundleOptions(options);
  const inv = directoryInventory(localDir);
  return inv.files.length >= opts.fileCountThreshold;
}

async function ensureNamedFolder(client, parentFolderId, name) {
  const listing = await listAll(client, parentFolderId);
  const existing = listing.fileListAO.folderList.find((folder) => folder.name === name);
  if (existing) return { ...existing, existed: true };
  const created = await createRemoteFolder(client, parentFolderId, name);
  return { ...created, existed: false };
}

function chunkInventoryIntoBundles(files, bundleSize) {
  const bundles = [];
  let current = [];
  let currentSize = 0;
  for (const file of files) {
    if (current.length && currentSize + file.size > bundleSize) {
      bundles.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(file);
    currentSize += file.size;
  }
  if (current.length) bundles.push(current);
  return bundles;
}

function tarCreate(tarPath, root, files) {
  const listPath = path.join(path.dirname(tarPath), `${path.basename(tarPath)}.files`);
  fs.writeFileSync(listPath, files.map((file) => file.path).join('\n'), 'utf8');
  try {
    execFileSync('tar', ['-cf', tarPath, '-C', root, '-T', listPath], { stdio: 'pipe' });
  } finally {
    fs.rmSync(listPath, { force: true });
  }
}

function tarExtract(tarPath, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  execFileSync('tar', ['-xf', tarPath, '-C', outputDir], { stdio: 'pipe' });
}

async function uploadJsonAsFile(client, object, fileName, parentFolderId) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-dir-json-'));
  const tmpPath = path.join(tmpDir, fileName);
  fs.writeFileSync(tmpPath, JSON.stringify(object, null, 2), 'utf8');
  try {
    return await client.upload({ parentFolderId, filePath: tmpPath });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function indexFilesByName(files) {
  const out = new Map();
  for (const file of files) {
    const arr = out.get(file.name) || [];
    arr.push(file);
    out.set(file.name, arr);
  }
  return out;
}

async function downloadRemoteFileToPath(client, remoteFileId, localPath) {
  const http = require('http');
  const https = require('https');
  const response = await client.getFileDownloadUrl({ fileId: remoteFileId }).json();
  const url = response.fileDownloadUrl;
  if (!url) throw new Error(`No download URL returned for ${remoteFileId}`);
  fs.mkdirSync(path.dirname(path.resolve(localPath)), { recursive: true });

  async function download(urlToFetch, redirectsLeft = 5) {
    await new Promise((resolve, reject) => {
      const transport = urlToFetch.startsWith('https:') ? https : http;
      transport.get(urlToFetch, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          resolve(download(new URL(res.headers.location, urlToFetch).toString(), redirectsLeft - 1));
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

  await download(url);
}

async function remoteBundleReusable(client, remoteFile, expected, tmpDir, verify) {
  if (!remoteFile) return false;
  if (Number(remoteFile.size || 0) !== Number(expected.size || 0)) return false;
  if (!verify) return true;
  const tmpPath = path.join(tmpDir, `verify-${expected.name}`);
  await downloadRemoteFileToPath(client, remoteFile.id, tmpPath);
  const actual = await hashFile(tmpPath);
  fs.rmSync(tmpPath, { force: true });
  return actual === expected.sha256;
}

async function writeProgress(client, dirFolderId, progress, existingProgressFiles) {
  if (existingProgressFiles.length) {
    await deleteRemoteFiles(client, existingProgressFiles);
    existingProgressFiles.length = 0;
  }
  const result = await uploadJsonAsFile(client, progress, DIR_PROGRESS_NAME, dirFolderId);
  existingProgressFiles.push({ id: result.file.userFileId, name: DIR_PROGRESS_NAME, parentId: dirFolderId, size: result.file.fileSize });
}

async function uploadDirectoryAsBundle(client, localDir, remoteFolderId, options = {}) {
  const opts = dirBundleOptions(options);
  const inv = directoryInventory(localDir);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-dir-bundle-'));
  const bundleSize = safeChunkSizeForDirectory(tmpDir, opts.bundleSize, opts);
  const dirFolder = options.useTargetAsDirBundle
    ? { id: remoteFolderId, name: inv.rootName, existed: true }
    : await ensureNamedFolder(client, remoteFolderId, dirBundleFolderNameFor(inv.rootName));
  const bundlesFolder = await ensureNamedFolder(client, dirFolder.id, BUNDLES_DIR);
  const remoteListing = await listAll(client, bundlesFolder.id);
  const remoteByName = indexFilesByName(remoteListing.fileListAO.fileList);
  const dirListing = await listAll(client, dirFolder.id);
  const progressFiles = dirListing.fileListAO.fileList.filter((file) => file.name === DIR_PROGRESS_NAME);
  const manifestFiles = dirListing.fileListAO.fileList.filter((file) => file.name === DIR_MANIFEST_NAME);
  const groups = chunkInventoryIntoBundles(inv.files, bundleSize);
  const bundles = [];
  let reused = 0;
  let uploaded = 0;

  try {
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const tmpTar = path.join(tmpDir, `bundle-${String(index).padStart(6, '0')}.tmp.tar`);
      tarCreate(tmpTar, inv.root, group);
      const sha256 = await hashFile(tmpTar);
      const name = `bundle-${String(index).padStart(6, '0')}-${sha256.slice(0, 16)}.tar`;
      const finalTar = path.join(tmpDir, name);
      fs.renameSync(tmpTar, finalTar);
      const stat = fs.statSync(finalTar);
      const fileRecords = group.map((file) => ({ path: file.path, size: file.size, mtimeMs: file.mtimeMs }));
      const expected = { index, name, size: stat.size, sha256, fileCount: group.length, files: fileRecords };
      const candidates = remoteByName.get(name) || [];
      let reusable = null;
      for (const candidate of candidates) {
        if (await remoteBundleReusable(client, candidate, expected, tmpDir, opts.verifyRemoteBundles)) {
          reusable = candidate;
          break;
        }
      }
      if (reusable) {
        bundles.push({ ...expected, remoteFileId: reusable.id, reused: true });
        reused += 1;
      } else {
        if (opts.verifyRemoteBundles && candidates.length) {
          await deleteRemoteFiles(client, candidates);
        }
        const result = await client.upload({ parentFolderId: bundlesFolder.id, filePath: finalTar }, options.callbacks);
        bundles.push({ ...expected, remoteFileId: result.file.userFileId, reused: false });
        uploaded += 1;
      }
      fs.rmSync(finalTar, { force: true });
      await writeProgress(client, dirFolder.id, {
        version: 1,
        type: 'cloud189-dir-progress',
        rootName: inv.rootName,
        fileCount: inv.files.length,
        totalSize: inv.totalSize,
        completedBundles: bundles.length,
        bundleCount: groups.length,
        bundles
      }, progressFiles);
    }

    if (manifestFiles.length) await deleteRemoteFiles(client, manifestFiles);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const manifest = {
    version: 1,
    type: 'cloud189-dir',
    rootName: inv.rootName,
    fileCount: inv.files.length,
    totalSize: inv.totalSize,
    bundleSize,
    bundleCount: bundles.length,
    bundles
  };
  const manifestUpload = await uploadJsonAsFile(client, manifest, DIR_MANIFEST_NAME, dirFolder.id);
  return {
    localPath: inv.root,
    remoteFolderId: dirFolder.id,
    dirName: inv.rootName,
    dirBundle: true,
    resumed: dirFolder.existed,
    reusedBundles: reused,
    uploadedBundles: uploaded,
    bundleCount: bundles.length,
    fileCount: inv.files.length,
    manifestRemoteFileId: manifestUpload.file.userFileId
  };
}

async function maybeReadDirManifest(client, remoteFolderId, downloadFileToPath) {
  const listing = await listAll(client, remoteFolderId);
  const manifestFile = listing.fileListAO.fileList.find((file) => file.name === DIR_MANIFEST_NAME);
  if (!manifestFile) return null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-dir-manifest-'));
  const manifestPath = path.join(tmpDir, DIR_MANIFEST_NAME);
  try {
    await downloadFileToPath(manifestFile.id, manifestPath);
    return { manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), listing };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function downloadDirectoryBundle(client, remoteFolderId, localDir, remoteName, downloadFileToPath, options = {}) {
  const read = await maybeReadDirManifest(client, remoteFolderId, downloadFileToPath);
  if (!read || read.manifest.type !== 'cloud189-dir') return null;
  const { manifest, listing } = read;
  const bundlesFolder = listing.fileListAO.folderList.find((folder) => folder.name === BUNDLES_DIR);
  if (!bundlesFolder) throw new Error('Directory bundle is missing bundles/ folder');
  const bundlesListing = await listAll(client, bundlesFolder.id);
  const remoteByName = new Map(bundlesListing.fileListAO.fileList.map((file) => [file.name, file]));
  const outputRoot = path.join(localDir, manifest.rootName || originalNameFromDirBundle(remoteName));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-dir-restore-'));
  try {
    for (const bundle of manifest.bundles) {
      const remote = remoteByName.get(bundle.name);
      if (!remote) throw new Error(`Missing directory bundle: ${bundle.name}`);
      const tarPath = path.join(tmpDir, bundle.name);
      await downloadFileToPath(remote.id, tarPath);
      if (bundle.sha256) {
        const actual = await hashFile(tarPath);
        if (actual !== bundle.sha256) throw new Error(`Checksum mismatch for directory bundle: ${bundle.name}`);
      }
      tarExtract(tarPath, outputRoot);
      fs.rmSync(tarPath, { force: true });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return [{ remoteFileId: remoteFolderId, localPath: outputRoot, dirBundle: true, bundleCount: manifest.bundleCount, fileCount: manifest.fileCount }];
}

module.exports = {
  BUNDLES_DIR,
  DIR_FOLDER_SUFFIX,
  DIR_MANIFEST_NAME,
  DIR_PROGRESS_NAME,
  dirBundleOptions,
  downloadDirectoryBundle,
  isDirBundleFolderName,
  originalNameFromDirBundle,
  shouldBundleDirectory,
  uploadDirectoryAsBundle
};
