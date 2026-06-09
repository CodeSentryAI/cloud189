const fs = require('fs');
const path = require('path');
const { walkFiles } = require('./fs-utils');

const DEFAULT_SIMPLE_UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_SIMPLE_DIR_FILE_COUNT_LIMIT = 1000;

function parseBytes(value, fallback = DEFAULT_SIMPLE_UPLOAD_LIMIT_BYTES) {
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

function uploadPolicyOptions(options = {}) {
  return {
    simpleLimitBytes: parseBytes(options.simpleLimitBytes || process.env.CLOUD189_SIMPLE_UPLOAD_LIMIT, DEFAULT_SIMPLE_UPLOAD_LIMIT_BYTES),
    dirFileCountLimit: Number(options.dirFileCountLimit || process.env.CLOUD189_SIMPLE_DIR_FILE_COUNT || DEFAULT_SIMPLE_DIR_FILE_COUNT_LIMIT)
  };
}

function classifyLocalPath(localPath, options = {}) {
  const opts = uploadPolicyOptions(options);
  const resolved = path.resolve(localPath);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    return {
      kind: 'file',
      mode: stat.size <= opts.simpleLimitBytes ? 'small-file' : 'large-file',
      path: resolved,
      size: stat.size,
      fileCount: 1,
      simpleLimitBytes: opts.simpleLimitBytes,
      dirFileCountLimit: opts.dirFileCountLimit
    };
  }
  if (!stat.isDirectory()) {
    const error = new Error(`Unsupported local path type: ${localPath}`);
    error.code = 'UNSUPPORTED_LOCAL_PATH';
    throw error;
  }

  let totalSize = 0;
  let fileCount = 0;
  for (const filePath of walkFiles(resolved)) {
    const fileStat = fs.statSync(filePath);
    totalSize += fileStat.size;
    fileCount += 1;
  }
  const small = totalSize <= opts.simpleLimitBytes && fileCount <= opts.dirFileCountLimit;
  return {
    kind: 'dir',
    mode: small ? 'small-dir' : 'large-dir',
    path: resolved,
    size: totalSize,
    fileCount,
    simpleLimitBytes: opts.simpleLimitBytes,
    dirFileCountLimit: opts.dirFileCountLimit
  };
}

function largeObjectError(classification, operation = 'upload') {
  const isFile = classification.kind === 'file';
  const suggestedCommand = `${operation}-large-${isFile ? 'file' : 'dir'}`;
  const reason = isFile
    ? `File is larger than the simple upload limit (${classification.size} > ${classification.simpleLimitBytes}).`
    : `Directory is too large for simple upload (${classification.size} bytes, ${classification.fileCount} files; limits: ${classification.simpleLimitBytes} bytes and ${classification.dirFileCountLimit} files).`;
  const error = new Error(`${reason}\nUse: cloud189 ${suggestedCommand} ${classification.path} <remoteFolderId>`);
  error.code = isFile ? 'LARGE_FILE_REQUIRES_EXPLICIT_COMMAND' : 'LARGE_DIR_REQUIRES_EXPLICIT_COMMAND';
  error.suggestedCommand = suggestedCommand;
  error.classification = classification;
  return error;
}

function simpleUploadGuard(localPath, options = {}) {
  const classification = classifyLocalPath(localPath, options);
  if (classification.mode === 'large-file' || classification.mode === 'large-dir') {
    throw largeObjectError(classification, 'upload');
  }
  return classification;
}

function simpleSyncGuard(localPath, options = {}) {
  const classification = classifyLocalPath(localPath, options);
  if (classification.mode === 'large-file' || classification.mode === 'large-dir') {
    throw largeObjectError(classification, 'sync');
  }
  return classification;
}

module.exports = {
  DEFAULT_SIMPLE_DIR_FILE_COUNT_LIMIT,
  DEFAULT_SIMPLE_UPLOAD_LIMIT_BYTES,
  classifyLocalPath,
  largeObjectError,
  parseBytes,
  simpleSyncGuard,
  simpleUploadGuard,
  uploadPolicyOptions
};
