const { CloudClient } = require('cloud189-sdk');
const { EncryptedTokenStore } = require('./session/encrypted-token-store');
const { redactString } = require('./session/redact');

function createClient(options = {}) {
  const tokenStore = new EncryptedTokenStore({
    configDir: options.configDir,
    sessionPath: options.sessionPath,
    devicePath: options.devicePath
  });

  // Preload session from encrypted store
  const existing = tokenStore.get();

  const client = new CloudClient({
    username: options.username,
    password: options.password,
    ssonCookie: options.ssonCookie,
    onQRCodeReady: options.onQRCodeReady,
    qrLoginOptions: options.qrLoginOptions,
    token: tokenStore
  });

  // If we already have valid tokens, prime the client's session
  // so getSession() can use them without re-authenticating
  if (existing.accessToken && existing.expiresIn > Date.now()) {
    client.session.accessToken = existing.accessToken;
    client.session.sessionKey = existing.sessionKey || '';
  }

  return client;
}

module.exports = { createClient };
