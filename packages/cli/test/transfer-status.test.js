const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectTransfer } = require('../src/transfer-status');

test('inspectTransfer reports in-progress split upload from progress manifest', async () => {
  const progress = {
    version: 1,
    type: 'cloud189-split-progress',
    originalName: 'big.bin',
    size: 100,
    chunkSize: 25,
    chunkCount: 4,
    completedChunks: 2,
    chunks: [
      { index: 0, name: 'part-000000-a', size: 25, sha256: 'a' },
      { index: 1, name: 'part-000001-b', size: 25, sha256: 'b' }
    ]
  };
  const client = fakeClient({
    container: { files: [{ id: 'progress', name: '.cloud189-split-progress.json', size: JSON.stringify(progress).length }], folders: [] },
    downloads: { progress: JSON.stringify(progress) }
  });

  const status = await inspectTransfer(client, 'container');

  assert.equal(status.ok, true);
  assert.equal(status.mode, 'large-file-split');
  assert.equal(status.status, 'in_progress');
  assert.equal(status.complete, false);
  assert.equal(status.completedUnits, 2);
  assert.equal(status.totalUnits, 4);
  assert.equal(status.completedBytes, 50);
  assert.equal(status.totalBytes, 100);
  assert.equal(status.percent, 50);
  assert.equal(status.resumeSupported, true);
});

test('inspectTransfer reports completed directory bundle from manifest', async () => {
  const manifest = {
    version: 1,
    type: 'cloud189-dir',
    rootName: 'dataset',
    fileCount: 3,
    totalSize: 60,
    bundleSize: 30,
    bundleCount: 2,
    bundles: [
      { index: 0, name: 'bundle-000000-a.tar', size: 30, sha256: 'a', fileCount: 2 },
      { index: 1, name: 'bundle-000001-b.tar', size: 30, sha256: 'b', fileCount: 1 }
    ]
  };
  const client = fakeClient({
    container: { files: [{ id: 'manifest', name: '.cloud189-dir-manifest.json', size: JSON.stringify(manifest).length }], folders: [{ id: 'bundles', name: 'bundles' }] },
    downloads: { manifest: JSON.stringify(manifest) }
  });

  const status = await inspectTransfer(client, 'container');

  assert.equal(status.ok, true);
  assert.equal(status.mode, 'large-dir-bundle');
  assert.equal(status.status, 'complete');
  assert.equal(status.complete, true);
  assert.equal(status.completedUnits, 2);
  assert.equal(status.totalUnits, 2);
  assert.equal(status.completedBytes, 60);
  assert.equal(status.totalBytes, 60);
  assert.equal(status.fileCount, 3);
  assert.equal(status.percent, 100);
});

function fakeClient({ container, downloads }) {
  return {
    async getListFiles({ folderId }) {
      assert.equal(folderId, 'container');
      return {
        fileListAO: {
          count: container.files.length + container.folders.length,
          fileList: container.files,
          folderList: container.folders
        },
        lastRev: 1
      };
    },
    getFileDownloadUrl({ fileId }) {
      return { json: async () => ({ fileDownloadUrl: `memory://${fileId}` }) };
    },
    async downloadJson(fileId) {
      return JSON.parse(downloads[fileId]);
    }
  };
}
