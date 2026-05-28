const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectRemoteEntries,
  createRemoteFolder,
  deleteRemoteItem,
  listAll,
  moveRemoteItem,
  resolveFolderId,
  searchRemoteEntries
} = require('../src/remote');

function emptyListing() {
  return listing();
}

function listing(files = [], folders = []) {
  return {
    fileListAO: {
      count: files.length + folders.length,
      fileList: files,
      folderList: folders
    },
    lastRev: 1
  };
}

test('resolveFolderId defaults to personal cloud root', () => {
  assert.equal(resolveFolderId(undefined), '-11');
  assert.equal(resolveFolderId('0'), '0');
});

test('listAll uses personal cloud root when folderId is omitted', async () => {
  const calls = [];
  const client = {
    async getListFiles(query) {
      calls.push(query);
      return emptyListing();
    }
  };

  await listAll(client);

  assert.equal(calls[0].folderId, '-11');
});

test('createRemoteFolder defaults omitted parent to personal cloud root', async () => {
  const calls = [];
  const client = {
    async createFolder(request) {
      calls.push(request);
      return { id: 'new-folder', name: request.folderName, parentId: request.parentFolderId };
    }
  };

  const created = await createRemoteFolder(client, undefined, 'Photos');

  assert.equal(created.id, 'new-folder');
  assert.deepEqual(calls[0], { parentFolderId: '-11', folderName: 'Photos' });
});

test('deleteRemoteItem sends a DELETE batch task', async () => {
  const calls = [];
  const client = {
    async createBatchTask(request) {
      calls.push(request);
      return { taskId: 'task-1', taskStatus: 4 };
    }
  };

  await deleteRemoteItem(client, 'folder-1', { isFolder: true, name: 'Old' });

  assert.deepEqual(calls[0], {
    type: 'DELETE',
    taskInfos: [{ fileId: 'folder-1', fileName: 'Old', isFolder: 1, srcParentId: undefined }],
    targetFolderId: undefined
  });
});

test('moveRemoteItem sends a MOVE batch task', async () => {
  const calls = [];
  const client = {
    async createBatchTask(request) {
      calls.push(request);
      return { taskId: 'task-1', taskStatus: 4 };
    }
  };

  await moveRemoteItem(client, 'file-1', 'target-1', { parentId: 'source-1' });

  assert.deepEqual(calls[0], {
    type: 'MOVE',
    taskInfos: [{ fileId: 'file-1', fileName: undefined, isFolder: 0, srcParentId: 'source-1' }],
    targetFolderId: 'target-1'
  });
});

test('collectRemoteEntries walks folders through the requested depth', async () => {
  const client = {
    async getListFiles(query) {
      if (query.folderId === '-11') {
        return listing([{ id: 'file-1', name: 'root.txt', size: 1 }], [{ id: 'dir-1', name: 'Docs' }]);
      }
      if (query.folderId === 'dir-1') {
        return listing([{ id: 'file-2', name: 'note.txt', size: 2 }]);
      }
      return emptyListing();
    }
  };

  const entries = await collectRemoteEntries(client, undefined, { maxDepth: 1 });

  assert.deepEqual(entries.map((entry) => entry.path), ['Docs', 'Docs/note.txt', 'root.txt']);
});

test('searchRemoteEntries filters by name or path', async () => {
  const client = {
    async getListFiles(query) {
      if (query.folderId === '-11') {
        return listing([], [{ id: 'dir-1', name: 'Projects' }]);
      }
      if (query.folderId === 'dir-1') {
        return listing([{ id: 'file-1', name: 'cloud189-notes.txt', size: 1 }]);
      }
      return emptyListing();
    }
  };

  const entries = await searchRemoteEntries(client, 'notes', undefined, { maxDepth: 2 });

  assert.deepEqual(entries.map((entry) => entry.path), ['Projects/cloud189-notes.txt']);
});
