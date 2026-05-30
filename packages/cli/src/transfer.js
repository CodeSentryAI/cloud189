const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { ensureRemoteFolderPath, listAll } = require('./remote');
const { relativeKey, walkFiles } = require('./fs-utils');

function requestStream(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https:') ? https : http;
    const request = transport.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects > 0) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        resolve(requestStream(nextUrl, redirects - 1));
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

async function uploadPath(client, localPath, remoteFolderId, options = {}) {
  const stat = fs.statSync(localPath);
  if (stat.isFile()) {
    const result = await client.upload({ parentFolderId: remoteFolderId, filePath: localPath }, options.callbacks);
    return [{ localPath, remoteFileId: result.file.userFileId, fileName: result.file.fileName }];
  }

  const root = path.resolve(localPath);
  const uploaded = [];
  for (const filePath of walkFiles(root)) {
    const relative = relativeKey(root, filePath);
    const folderParts = relative.split('/').slice(0, -1);
    const targetFolderId = await ensureRemoteFolderPath(client, remoteFolderId, folderParts);
    const result = await client.upload({ parentFolderId: targetFolderId, filePath }, options.callbacks);
    uploaded.push({ localPath: filePath, remoteFileId: result.file.userFileId, fileName: result.file.fileName });
  }
  return uploaded;
}

async function downloadFile(client, remoteFileId, localPath) {
  const response = await client.getFileDownloadUrl({ fileId: remoteFileId }).json();
  const url = response.fileDownloadUrl;
  if (!url) {
    throw new Error(`No download URL returned for ${remoteFileId}`);
  }

  fs.mkdirSync(path.dirname(path.resolve(localPath)), { recursive: true });
  const input = await requestStream(url);
  const output = fs.createWriteStream(localPath);

  await new Promise((resolve, reject) => {
    input.pipe(output);
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
  });

  return { remoteFileId, localPath };
}

async function downloadFolder(client, remoteFolderId, localDir) {
  const downloaded = [];
  fs.mkdirSync(localDir, { recursive: true });
  const listing = await listAll(client, remoteFolderId);

  for (const folder of listing.fileListAO.folderList) {
    const childDir = path.join(localDir, folder.name);
    const childResults = await downloadFolder(client, folder.id, childDir);
    downloaded.push(...childResults);
  }

  for (const file of listing.fileListAO.fileList) {
    const localPath = path.join(localDir, file.name);
    downloaded.push(await downloadFile(client, file.id, localPath));
  }

  return downloaded;
}

module.exports = {
  downloadFile,
  downloadFolder,
  uploadPath
};
