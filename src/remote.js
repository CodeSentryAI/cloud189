async function listAll(client, folderId) {
  const pageSize = 60;
  let pageNum = 1;
  const fileList = [];
  const folderList = [];
  let lastRev = 0;

  while (true) {
    const response = await client.getListFiles({ folderId, pageNum, pageSize });
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
  deleteRemoteFiles,
  ensureRemoteFolderPath,
  indexRemoteFilesByPath,
  listAll
};
