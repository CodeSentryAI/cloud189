const { saveSession, loadSession, clearSession, sessionStatus } = require('./store');
const { getConfigDir, ensureDir, getSessionPath, getDevicePath } = require('./paths');
const { redact, redactObject, maskAccount } = require('./redact');
const { EncryptedTokenStore } = require('./encrypted-token-store');

module.exports = {
  saveSession,
  loadSession,
  clearSession,
  sessionStatus,
  getConfigDir,
  ensureDir,
  getSessionPath,
  getDevicePath,
  redact,
  redactObject,
  maskAccount,
  EncryptedTokenStore
};
