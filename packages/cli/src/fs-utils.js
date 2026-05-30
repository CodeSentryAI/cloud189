const fs = require('fs');
const path = require('path');

function walkFiles(root) {
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    return [root];
  }

  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function fileSignature(filePath) {
  const stat = fs.statSync(filePath);
  return {
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs)
  };
}

function relativeKey(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

module.exports = {
  fileSignature,
  relativeKey,
  walkFiles
};
