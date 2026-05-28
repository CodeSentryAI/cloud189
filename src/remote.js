const PERSONAL_ROOT_FOLDER_ID = '-11';

function resolveFolderId(folderId) {
  return folderId === undefined ? PERSONAL_ROOT_FOLDER_ID : folderId;
}

function taskInfo(remoteId, options = {}) {
  return {
    fileId: remoteId,
    fileName: options.name,
    isFolder: options.isFolder ? 1 : 0,
    srcParentId: options.parentId
  };
}

async function listAll(client, folderId) {
  const resolvedFolderId = resolveFolderId(folderId);
  const pageSize = 60;
  let pageNum = 1;
  const fileList = [];
  const folderList = [];
  let lastRev = 0;

  while (true) {
    const response = await client.getListFiles({ folderId: resolvedFolderId, pageNum, pageSize });
    const page = response.fileListAO;
    fileList.push(...page.fileList);
    folderList.push(...page.folderList);
    lastRev = response.lastRev;

    if (fileList.length + folderList.length >= page.count || page.fileList.length + page.folderList.length === 0) {
      break;
    }
    pageNum += 1;
  }

  return {
    fileListAO: {
      count: fileList.length + folderList.length,
      fileList,
      folderList
    },
    lastRev
  };
}

async function createRemoteFolder(client, parentFolderId, folderName) {
  return client.createFolder({
    parentFolderId: resolveFolderId(parentFolderId),
    folderName
  });
}

async function renameRemoteFolder(client, folderId, folderName) {
  return client.renameFolder({ folderId, folderName });
}

async function runBatchTask(client, type, taskInfos, options = {}) {
  const result = await client.createBatchTask({
    type,
    taskInfos,
    targetFolderId: options.targetFolderId
  });

  if (result.taskId && result.taskStatus !== 4) {
    return client.checkTaskStatus(type, result.taskId);
  }

  return result;
}

async function deleteRemoteItem(client, remoteId, options = {}) {
  return runBatchTask(client, 'DELETE', [taskInfo(remoteId, options)]);
}

async function moveRemoteItem(client, remoteId, targetFolderId, options = {}) {
  return runBatchTask(client, 'MOVE', [taskInfo(remoteId, options)], {
    targetFolderId: resolveFolderId(targetFolderId)
  });
}

async function ensureRemoteFolderPath(client, parentFolderId, parts) {
  let currentParentId = parentFolderId;

  for (const part of parts.filter(Boolean)) {
    const listing = await listAll(client, currentParentId);
    const existing = listing.fileListAO.folderList.find((folder) => folder.name === part);
    if (existing) {
      currentParentId = existing.id;
      continue;
    }

    const created = await client.createFolder({
      parentFolderId: currentParentId,
      folderName: part
    });
    currentParentId = created.id;
  }

  return currentParentId;
}

async function collectRemoteTree(client, folderId, prefix = '') {
  const listing = await listAll(client, folderId);
  const files = listing.fileListAO.fileList.map((file) => ({
    ...file,
    relativePath: `${prefix}${file.name}`
  }));

  for (const folder of listing.fileListAO.folderList) {
    const children = await collectRemoteTree(client, folder.id, `${prefix}${folder.name}/`);
    files.push(...children);
  }

  return files;
}

async function collectRemoteEntries(client, folderId, options = {}) {
  const maxDepth = options.maxDepth ?? Infinity;
  const prefix = options.prefix || '';
  const depth = options.depth || 0;
  const listing = await listAll(client, folderId);
  const entries = [];

  for (const folder of listing.fileListAO.folderList) {
    const path = `${prefix}${folder.name}`;
    entries.push({ ...folder, type: 'dir', path });

    if (depth < maxDepth) {
      const childEntries = await collectRemoteEntries(client, folder.id, {
        maxDepth,
        prefix: `${path}/`,
        depth: depth + 1
      });
      entries.push(...childEntries);
    }
  }

  for (const file of listing.fileListAO.fileList) {
    entries.push({ ...file, type: 'file', path: `${prefix}${file.name}` });
  }

  return entries;
}

async function searchRemoteEntries(client, keyword, folderId, options = {}) {
  const needle = keyword.toLowerCase();
  const entries = await collectRemoteEntries(client, folderId, options);
  return entries.filter((entry) => {
    return entry.name.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle);
  });
}

function indexRemoteFilesByPath(files) {
  const index = new Map();
  for (const file of files) {
    const existing = index.get(file.relativePath) || [];
    existing.push(file);
    index.set(file.relativePath, existing);
  }
  return index;
}

async function deleteRemoteFiles(client, files) {
  if (!files.length) {
    return null;
  }

  const result = await client.createBatchTask({
    type: 'DELETE',
    taskInfos: files.map((file) => ({
      fileId: file.id,
      fileName: file.name,
      isFolder: 0,
      srcParentId: file.parentId
    }))
  });

  if (result.taskId) {
    await client.checkTaskStatus('DELETE', result.taskId);
  }

  return result;
}

module.exports = {
  collectRemoteTree,
  collectRemoteEntries,
  createRemoteFolder,
  deleteRemoteFiles,
  deleteRemoteItem,
  ensureRemoteFolderPath,
  indexRemoteFilesByPath,
  moveRemoteItem,
  listAll,
  PERSONAL_ROOT_FOLDER_ID,
  renameRemoteFolder,
  runBatchTask,
  resolveFolderId,
  searchRemoteEntries
};
