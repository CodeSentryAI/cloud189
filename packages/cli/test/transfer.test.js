const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { downloadFile, downloadFolder, uploadPath } = require('../src/transfer');
const { runUploadPass } = require('../src/sync');
const { DIR_MANIFEST_NAME, DIR_PROGRESS_NAME } = require('../src/directory-transfer');
const { MANIFEST_NAME, PROGRESS_NAME, MIN_CHUNK_SIZE, chunkNameFor, hashFile, safeChunkSizeForDirectory } = require('../src/large-transfer');

function withServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: (name) => `http://127.0.0.1:${port}/${name}`,
        close: () => new Promise((res) => server.close(res))
      });
    });
    server.on('error', reject);
  });
}

test('downloadFile writes into existing local directory using remote filename header', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-download-dir-'));
  const server = await withServer((req, res) => {
    res.setHeader('content-disposition', 'attachment; filename="remote.txt"');
    res.end('hello');
  });

  try {
    const client = {
      getFileDownloadUrl() {
        return { json: async () => ({ fileDownloadUrl: server.url('remote.txt') }) };
      }
    };

    const result = await downloadFile(client, 'file-1', dir);
    assert.equal(result.localPath, path.join(dir, 'remote.txt'));
    assert.equal(fs.readFileSync(path.join(dir, 'remote.txt'), 'utf8'), 'hello');
  } finally {
    await server.close();
  }
});

test('uploadPath splits files above threshold and uploads manifest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-upload-split-'));
  const filePath = path.join(dir, 'big.bin');
  fs.writeFileSync(filePath, Buffer.from('abcdefghijklmnop'));
  const uploaded = [];
  const client = {
    async getListFiles() {
      return { fileListAO: { count: 0, folderList: [], fileList: [] }, lastRev: 1 };
    },
    async createFolder({ folderName }) {
      return { id: `folder-${folderName}`, name: folderName };
    },
    async upload({ parentFolderId, filePath: uploadFilePath }) {
      uploaded.push({ parentFolderId, name: path.basename(uploadFilePath), content: fs.readFileSync(uploadFilePath) });
      return { file: { userFileId: `id-${uploaded.length}`, fileName: path.basename(uploadFilePath), fileSize: fs.statSync(uploadFilePath).size } };
    },
    async createBatchTask() {
      return { taskId: 'delete-task', taskStatus: 4 };
    },
    async checkTaskStatus() {
      return { taskId: 'delete-task', taskStatus: 4 };
    }
  };

  const result = await uploadPath(client, filePath, 'root', { largeFileThreshold: 4, chunkSize: 5 });
  assert.equal(result.length, 1);
  assert.equal(result[0].split, true);
  assert.equal(result[0].chunkCount, 4);
  const chunkNames = [];
  for (let index = 0; index < 4; index += 1) {
    const start = index * 5;
    const chunkPath = path.join(dir, `expected-${index}`);
    fs.writeFileSync(chunkPath, fs.readFileSync(filePath).subarray(start, Math.min(start + 5, 16)));
    chunkNames.push(chunkNameFor(index, await hashFile(chunkPath)));
  }
  assert.deepEqual(uploaded.map((item) => item.name), [
    chunkNames[0], PROGRESS_NAME,
    chunkNames[1], PROGRESS_NAME,
    chunkNames[2], PROGRESS_NAME,
    chunkNames[3], PROGRESS_NAME,
    MANIFEST_NAME
  ]);
});

test('downloadFolder reassembles split upload folder into original file', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-download-split-'));
  const manifest = {
    version: 1,
    type: 'cloud189-split-file',
    originalName: 'big.bin',
    size: 11,
    chunkSize: 5,
    chunkCount: 3,
    chunks: [
      { index: 0, name: 'part-000000', size: 5 },
      { index: 1, name: 'part-000001', size: 5 },
      { index: 2, name: 'part-000002', size: 1 }
    ]
  };
  const bodies = {
    manifest: JSON.stringify(manifest),
    p0: 'hello',
    p1: ' worl',
    p2: 'd'
  };
  const server = await withServer((req, res) => {
    const key = req.url.slice(1);
    res.end(bodies[key]);
  });

  try {
    const client = {
      async getListFiles() {
        return {
          fileListAO: {
            count: 4,
            folderList: [],
            fileList: [
              { id: 'manifest', name: MANIFEST_NAME },
              { id: 'p0', name: 'part-000000' },
              { id: 'p1', name: 'part-000001' },
              { id: 'p2', name: 'part-000002' }
            ]
          },
          lastRev: 1
        };
      },
      getFileDownloadUrl({ fileId }) {
        return { json: async () => ({ fileDownloadUrl: server.url(fileId) }) };
      }
    };

    const results = await downloadFolder(client, 'split-folder', outDir, { remoteName: 'big.bin.cloud189-split' });
    assert.equal(results.length, 1);
    assert.equal(fs.readFileSync(path.join(outDir, 'big.bin'), 'utf8'), 'hello world');
  } finally {
    await server.close();
  }
});


test('safeChunkSizeForDirectory leaves disk reserve and caps oversized configured chunks', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-disk-check-'));
  const stat = fs.statfsSync(tmpDir);
  const available = Number(stat.bavail) * Number(stat.bsize);
  const reserve = Math.max(0, available - (MIN_CHUNK_SIZE * 2));

  const capped = safeChunkSizeForDirectory(tmpDir, available * 2, { tmpReserveBytes: reserve });
  assert.equal(capped, MIN_CHUNK_SIZE * 2);
});

test('safeChunkSizeForDirectory refuses when temp dir cannot hold minimum chunk plus reserve', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-disk-check-'));
  const stat = fs.statfsSync(tmpDir);
  const available = Number(stat.bavail) * Number(stat.bsize);

  assert.throws(
    () => safeChunkSizeForDirectory(tmpDir, MIN_CHUNK_SIZE, { tmpReserveBytes: available }),
    /Not enough free space/
  );
});


test('uploadPath resumes split upload by reusing valid remote chunks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-resume-split-'));
  const filePath = path.join(dir, 'big.bin');
  fs.writeFileSync(filePath, Buffer.from('abcdefghijklmnop'));

  const firstChunkPath = path.join(dir, 'first-chunk');
  fs.writeFileSync(firstChunkPath, Buffer.from('abcde'));
  const firstChunkName = chunkNameFor(0, await hashFile(firstChunkPath));
  const uploaded = [];
  let deleted = [];

  const client = {
    async getListFiles({ folderId }) {
      if (folderId === 'root') {
        return { fileListAO: { count: 1, folderList: [{ id: 'split-folder', name: 'big.bin.cloud189-split' }], fileList: [] }, lastRev: 1 };
      }
      return {
        fileListAO: {
          count: 1,
          folderList: [],
          fileList: [{ id: 'existing-chunk-0', name: firstChunkName, size: 5 }]
        },
        lastRev: 1
      };
    },
    async upload({ filePath: uploadFilePath }) {
      uploaded.push(path.basename(uploadFilePath));
      return { file: { userFileId: `new-${uploaded.length}`, fileName: path.basename(uploadFilePath), fileSize: fs.statSync(uploadFilePath).size } };
    },
    async createBatchTask(request) {
      deleted.push(...request.taskInfos.map((item) => item.fileName));
      return { taskId: 'delete-task', taskStatus: 4 };
    },
    async checkTaskStatus() {
      return { taskId: 'delete-task', taskStatus: 4 };
    }
  };

  const result = await uploadPath(client, filePath, 'root', { largeFileThreshold: 4, chunkSize: 5 });
  assert.equal(result[0].resumed, true);
  assert.equal(result[0].reusedChunks, 1);
  assert.equal(result[0].uploadedChunks, 3);
  assert.equal(uploaded.filter((name) => name.startsWith('part-')).length, 3);
  assert(!deleted.includes(firstChunkName));
});

test('uploadPath deletes and reuploads corrupt same-name remote chunk when verification is enabled', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-verify-split-'));
  const filePath = path.join(dir, 'big.bin');
  fs.writeFileSync(filePath, Buffer.from('abcdef'));

  const firstChunkPath = path.join(dir, 'first-chunk');
  fs.writeFileSync(firstChunkPath, Buffer.from('abc'));
  const firstChunkName = chunkNameFor(0, await hashFile(firstChunkPath));
  const uploaded = [];
  const deleted = [];
  const server = await withServer((req, res) => {
    res.end('BAD');
  });

  try {
    const client = {
      async getListFiles({ folderId }) {
        if (folderId === 'root') {
          return { fileListAO: { count: 1, folderList: [{ id: 'split-folder', name: 'big.bin.cloud189-split' }], fileList: [] }, lastRev: 1 };
        }
        return {
          fileListAO: {
            count: 1,
            folderList: [],
            fileList: [{ id: 'corrupt-chunk-0', name: firstChunkName, size: 3 }]
          },
          lastRev: 1
        };
      },
      getFileDownloadUrl() {
        return { json: async () => ({ fileDownloadUrl: server.url('corrupt') }) };
      },
      async upload({ filePath: uploadFilePath }) {
        uploaded.push(path.basename(uploadFilePath));
        return { file: { userFileId: `new-${uploaded.length}`, fileName: path.basename(uploadFilePath), fileSize: fs.statSync(uploadFilePath).size } };
      },
      async createBatchTask(request) {
        deleted.push(...request.taskInfos.map((item) => item.fileId));
        return { taskId: 'delete-task', taskStatus: 4 };
      },
      async checkTaskStatus() {
        return { taskId: 'delete-task', taskStatus: 4 };
      }
    };

    const result = await uploadPath(client, filePath, 'root', {
      largeFileThreshold: 2,
      chunkSize: 3,
      verifyRemoteChunks: true
    });
    assert.equal(result[0].reusedChunks, 0);
    assert(deleted.includes('corrupt-chunk-0'));
    assert(uploaded.includes(firstChunkName));
  } finally {
    await server.close();
  }
});


test('uploadPath bundles arbitrary nested directory when file count exceeds threshold', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-dir-upload-'));
  fs.mkdirSync(path.join(root, '00', '0', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(root, 'flat'), { recursive: true });
  fs.writeFileSync(path.join(root, '00', '0', 'deep', 'a.jpg'), 'a');
  fs.writeFileSync(path.join(root, '00', '0', 'deep', 'b.jpg'), 'b');
  fs.writeFileSync(path.join(root, 'flat', 'c.jpg'), 'c');
  fs.writeFileSync(path.join(root, 'd.jpg'), 'd');

  const uploaded = [];
  const folders = new Map([
    ['root', { folders: [], files: [] }]
  ]);
  let nextId = 1;
  const client = {
    async getListFiles({ folderId }) {
      const entry = folders.get(folderId) || { folders: [], files: [] };
      return { fileListAO: { count: entry.folders.length + entry.files.length, folderList: entry.folders, fileList: entry.files }, lastRev: 1 };
    },
    async createFolder({ parentFolderId, folderName }) {
      const folder = { id: `folder-${nextId++}`, name: folderName, parentId: parentFolderId };
      const parent = folders.get(parentFolderId) || { folders: [], files: [] };
      parent.folders.push(folder);
      folders.set(parentFolderId, parent);
      folders.set(folder.id, { folders: [], files: [] });
      return folder;
    },
    async upload({ parentFolderId, filePath: uploadFilePath }) {
      const file = { id: `file-${nextId++}`, name: path.basename(uploadFilePath), size: fs.statSync(uploadFilePath).size, parentId: parentFolderId };
      const parent = folders.get(parentFolderId) || { folders: [], files: [] };
      parent.files.push(file);
      folders.set(parentFolderId, parent);
      uploaded.push({ parentFolderId, name: file.name, content: fs.readFileSync(uploadFilePath) });
      return { file: { userFileId: file.id, fileName: file.name, fileSize: file.size } };
    },
    async createBatchTask(request) {
      return { taskId: 'delete-task', taskStatus: 4 };
    },
    async checkTaskStatus() {
      return { taskId: 'delete-task', taskStatus: 4 };
    }
  };

  const result = await uploadPath(client, root, 'root', { dirBundleFileCountThreshold: 2, dirBundleSize: 1024 * 1024 });
  assert.equal(result.length, 1);
  assert.equal(result[0].dirBundle, true);
  assert.equal(result[0].fileCount, 4);
  assert(uploaded.some((item) => item.name.startsWith('bundle-')));
  assert(uploaded.some((item) => item.name === DIR_PROGRESS_NAME));
  assert(uploaded.some((item) => item.name === DIR_MANIFEST_NAME));
});

test('downloadFolder restores .cloud189-dir bundle with nested and flat files', async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-dir-restore-src-'));
  fs.mkdirSync(path.join(src, '00', '0'), { recursive: true });
  fs.writeFileSync(path.join(src, '00', '0', 'a.jpg'), 'a');
  fs.writeFileSync(path.join(src, 'b.jpg'), 'b');
  const tarPath = path.join(src, 'bundle.tar');
  require('node:child_process').execFileSync('tar', ['-cf', tarPath, '-C', src, '00/0/a.jpg', 'b.jpg']);
  const bundleSha = await hashFile(tarPath);
  const manifest = {
    version: 1,
    type: 'cloud189-dir',
    rootName: 'dataset',
    fileCount: 2,
    totalSize: 2,
    bundleSize: 1024,
    bundleCount: 1,
    bundles: [{ index: 0, name: `bundle-000000-${bundleSha.slice(0, 16)}.tar`, size: fs.statSync(tarPath).size, sha256: bundleSha, fileCount: 2, files: [] }]
  };
  const bodies = {
    manifest: JSON.stringify(manifest),
    bundle: fs.readFileSync(tarPath)
  };
  const server = await withServer((req, res) => {
    const key = req.url.slice(1);
    res.end(bodies[key]);
  });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-dir-restore-out-'));

  try {
    const client = {
      async getListFiles({ folderId }) {
        if (folderId === 'dir-folder') {
          return { fileListAO: { count: 2, folderList: [{ id: 'bundles-folder', name: 'bundles' }], fileList: [{ id: 'manifest', name: DIR_MANIFEST_NAME }] }, lastRev: 1 };
        }
        return { fileListAO: { count: 1, folderList: [], fileList: [{ id: 'bundle', name: manifest.bundles[0].name }] }, lastRev: 1 };
      },
      getFileDownloadUrl({ fileId }) {
        return { json: async () => ({ fileDownloadUrl: server.url(fileId === 'manifest' ? 'manifest' : 'bundle') }) };
      }
    };
    const result = await downloadFolder(client, 'dir-folder', out, { remoteName: 'dataset.cloud189-dir' });
    assert.equal(result[0].dirBundle, true);
    assert.equal(fs.readFileSync(path.join(out, 'dataset', '00', '0', 'a.jpg'), 'utf8'), 'a');
    assert.equal(fs.readFileSync(path.join(out, 'dataset', 'b.jpg'), 'utf8'), 'b');
  } finally {
    await server.close();
  }
});

test('uploadPath reuses verified directory bundle when download URL redirects', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-dir-verify-redirect-'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'a');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b');

  const uploaded = [];
  const folders = new Map([
    ['root', { folders: [], files: [] }]
  ]);
  let nextId = 1;
  const client = {
    async getListFiles({ folderId }) {
      const entry = folders.get(folderId) || { folders: [], files: [] };
      return { fileListAO: { count: entry.folders.length + entry.files.length, folderList: entry.folders, fileList: entry.files }, lastRev: 1 };
    },
    async createFolder({ parentFolderId, folderName }) {
      const folder = { id: `folder-${nextId++}`, name: folderName, parentId: parentFolderId };
      const parent = folders.get(parentFolderId) || { folders: [], files: [] };
      parent.folders.push(folder);
      folders.set(parentFolderId, parent);
      folders.set(folder.id, { folders: [], files: [] });
      return folder;
    },
    async upload({ parentFolderId, filePath: uploadFilePath }) {
      const file = { id: `file-${nextId++}`, name: path.basename(uploadFilePath), size: fs.statSync(uploadFilePath).size, parentId: parentFolderId };
      const parent = folders.get(parentFolderId) || { folders: [], files: [] };
      parent.files.push(file);
      folders.set(parentFolderId, parent);
      uploaded.push({ ...file, content: fs.readFileSync(uploadFilePath) });
      return { file: { userFileId: file.id, fileName: file.name, fileSize: file.size } };
    },
    async createBatchTask() {
      return { taskId: 'delete-task', taskStatus: 4 };
    },
    async checkTaskStatus() {
      return { taskId: 'delete-task', taskStatus: 4 };
    }
  };

  await uploadPath(client, root, 'root', { dirBundleFileCountThreshold: 2, dirBundleSize: 1024 * 1024 });
  const uploadedBundle = uploaded.find((item) => item.name.startsWith('bundle-'));
  assert(uploadedBundle);
  const dirFolder = folders.get('root').folders.find((folder) => folder.name.endsWith('.cloud189-dir'));
  const bundlesFolder = folders.get(dirFolder.id).folders.find((folder) => folder.name === 'bundles');
  const server = await withServer((req, res) => {
    if (req.url === '/redirect') {
      res.statusCode = 302;
      res.setHeader('location', '/bundle');
      res.end();
      return;
    }
    res.end(uploadedBundle.content);
  });

  try {
    client.getFileDownloadUrl = () => ({ json: async () => ({ fileDownloadUrl: server.url('redirect') }) });
    const beforeBundles = uploaded.filter((item) => item.name.startsWith('bundle-')).length;
    const result = await uploadPath(client, root, 'root', { dirBundleFileCountThreshold: 2, dirBundleSize: 1024 * 1024, verifyRemoteBundles: true });
    const afterBundles = uploaded.filter((item) => item.name.startsWith('bundle-')).length;
    assert.equal(result[0].reusedBundles, 1);
    assert.equal(result[0].uploadedBundles, 0);
    assert.equal(afterBundles, beforeBundles);
  } finally {
    await server.close();
  }
});

test('sync-upload automatically routes huge arbitrary directory to dir bundle', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-sync-dir-bundle-'));
  fs.writeFileSync(path.join(root, 'a.jpg'), 'a');
  fs.writeFileSync(path.join(root, 'b.jpg'), 'b');
  const statePath = path.join(root, 'state.json');
  const uploaded = [];
  const folders = new Map([['root', { folders: [], files: [] }]]);
  let nextId = 1;
  const client = {
    async getListFiles({ folderId }) {
      const entry = folders.get(folderId) || { folders: [], files: [] };
      return { fileListAO: { count: entry.folders.length + entry.files.length, folderList: entry.folders, fileList: entry.files }, lastRev: 1 };
    },
    async createFolder({ parentFolderId, folderName }) {
      const folder = { id: `folder-${nextId++}`, name: folderName, parentId: parentFolderId };
      const parent = folders.get(parentFolderId) || { folders: [], files: [] };
      parent.folders.push(folder);
      folders.set(parentFolderId, parent);
      folders.set(folder.id, { folders: [], files: [] });
      return folder;
    },
    async upload({ parentFolderId, filePath: uploadFilePath }) {
      const file = { id: `file-${nextId++}`, name: path.basename(uploadFilePath), size: fs.statSync(uploadFilePath).size, parentId: parentFolderId };
      const parent = folders.get(parentFolderId) || { folders: [], files: [] };
      parent.files.push(file);
      folders.set(parentFolderId, parent);
      uploaded.push(file.name);
      return { file: { userFileId: file.id, fileName: file.name, fileSize: file.size } };
    },
    async createBatchTask() {
      return { taskId: 'delete-task', taskStatus: 4 };
    },
    async checkTaskStatus() {
      return { taskId: 'delete-task', taskStatus: 4 };
    }
  };

  const result = await runUploadPass(client, root, 'root', statePath, { dirBundleFileCountThreshold: 2 });
  assert.deepEqual(result, [path.basename(root)]);
  assert(uploaded.some((name) => name.startsWith('bundle-')));
  assert(uploaded.includes(DIR_MANIFEST_NAME));
});
