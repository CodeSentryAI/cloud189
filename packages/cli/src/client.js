const { CloudClient, FileTokenStore } = require('cloud189-sdk');
const { ensureDir, getConfigDir, getTokenPath } = require('./config');

function createClient(options = {}) {
  const configDir = options.configDir || getConfigDir();
  ensureDir(configDir);

  return new CloudClient({
    username: options.username,
    password: options.password,
    ssonCookie: options.ssonCookie,
    onQRCodeReady: options.onQRCodeReady,
    qrLoginOptions: options.qrLoginOptions,
    token: new FileTokenStore(getTokenPath(configDir))
  });
}

module.exports = {
  createClient
};
