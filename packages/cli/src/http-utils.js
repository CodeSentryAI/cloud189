const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const REDIRECT_CODES = [301, 302, 303, 307, 308];
const DEFAULT_REDIRECTS = 5;

function requestStream(url, redirects = DEFAULT_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https:') ? https : http;
    const request = transport.get(url, (response) => {
      if (REDIRECT_CODES.includes(response.statusCode) && response.headers.location && redirects > 0) {
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

async function downloadUrlToFile(url, localPath, redirects = DEFAULT_REDIRECTS) {
  fs.mkdirSync(path.dirname(path.resolve(localPath)), { recursive: true });
  const input = await requestStream(url, redirects);
  const output = fs.createWriteStream(localPath);

  await new Promise((resolve, reject) => {
    input.pipe(output);
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
  });
}

async function fetchDownloadUrl(client, remoteFileId) {
  const response = await client.getFileDownloadUrl({ fileId: remoteFileId }).json();
  const url = response.fileDownloadUrl;
  if (!url) throw new Error(`No download URL returned for ${remoteFileId}`);
  return url;
}

module.exports = {
  DEFAULT_REDIRECTS,
  downloadUrlToFile,
  fetchDownloadUrl,
  requestStream
};
