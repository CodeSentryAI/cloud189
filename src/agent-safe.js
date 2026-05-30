const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureDir, readJson, writeJson } = require('./config');

const DEFAULT_AGENT_CONFIG_DIR = path.join(os.homedir(), '.cloud189-agent');
const DEFAULT_AGENT_NAME = 'hermes';

const SAFE_COMMANDS = new Set([
  'status',
  'quota',
  'roots',
  'list',
  'tree',
  'search',
  'download',
  'login',
  'login-qr',
  'login-sso',
  'mkdir',
  'mkdir-safe',
  'upload-safe',
  'sync-upload-safe',
  'sync-download',
  'plan',
  'init-agent',
  'agent-status'
]);

const DANGEROUS_COMMANDS = new Set([
  'rm',
  'mv',
  'rename-folder',
  'upload',
  'sync-upload'
]);

function defaultAgentConfig() {
  return {
    provider: 'cloud189',
    mode: 'user',
    agent: {
      name: DEFAULT_AGENT_NAME,
      writeRootId: '',
      writeRootName: DEFAULT_AGENT_NAME,
      allowDelete: false,
      allowMove: false,
      allowRename: false,
      allowOverwrite: false
    }
  };
}

function getAgentConfigDir(env = process.env) {
  return path.resolve(env.CLOUD189_AGENT_HOME || DEFAULT_AGENT_CONFIG_DIR);
}

function getAgentConfigPath(env = process.env) {
  return path.join(getAgentConfigDir(env), 'config.json');
}

function loadAgentConfig(env = process.env) {
  const loaded = readJson(getAgentConfigPath(env), {});
  const defaults = defaultAgentConfig();
  return {
    ...defaults,
    ...loaded,
    agent: {
      ...defaults.agent,
      ...(loaded.agent || {})
    }
  };
}

function saveAgentConfig(config, env = process.env) {
  const configPath = getAgentConfigPath(env);
  ensureDir(path.dirname(configPath));
  writeJson(configPath, config);
  return configPath;
}

function resolveAgentContext(options = {}, env = process.env, defaults = {}) {
  const config = loadAgentConfig(env);
  const agent = config.agent || {};
  const mode = options.mode || env.CLOUD189_MODE || config.mode || defaults.mode || 'user';
  return {
    provider: config.provider || 'cloud189',
    mode,
    agent: {
      ...agent,
      name: options.agent || env.CLOUD189_AGENT_NAME || agent.name || DEFAULT_AGENT_NAME,
      writeRootId: options.writeRootId || env.CLOUD189_WRITE_ROOT_ID || agent.writeRootId || '',
      writeRootName: agent.writeRootName || agent.name || DEFAULT_AGENT_NAME,
      allowDelete: Boolean(agent.allowDelete),
      allowMove: Boolean(agent.allowMove),
      allowRename: Boolean(agent.allowRename),
      allowOverwrite: Boolean(agent.allowOverwrite)
    },
    configPath: getAgentConfigPath(env)
  };
}

function isAgentSafeMode(context) {
  return context.mode === 'agent-safe';
}

function deniedError(command) {
  const error = new Error(`${command} is not allowed in agent-safe mode.`);
  error.code = 'DENIED_AGENT_SAFE';
  error.suggestion = `Use cloud189 plan ${command} <id> and ask the user to confirm.`;
  return error;
}

function assertCommandAllowed(command, context) {
  if (!isAgentSafeMode(context)) {
    return;
  }

  if (DANGEROUS_COMMANDS.has(command)) {
    throw deniedError(command);
  }

  if (!SAFE_COMMANDS.has(command)) {
    const error = new Error(`${command} is not allowed in agent-safe mode.`);
    error.code = 'DENIED_AGENT_SAFE';
    error.suggestion = `This command is not recognized as safe. Contact the administrator to allow it.`;
    throw error;
  }
}

function assertWriteRoot(remoteFolderId, context) {
  const writeRootId = context.agent.writeRootId;
  if (!writeRootId) {
    const error = new Error('Agent write root is not configured. Run cloud189 init-agent <name> first.');
    error.code = 'WRITE_ROOT_NOT_CONFIGURED';
    throw error;
  }
  if (String(remoteFolderId) !== String(writeRootId)) {
    const error = new Error('agent-safe writes are only allowed directly inside the configured write root.');
    error.code = 'DENIED_WRITE_ROOT';
    error.suggestion = `Use remoteFolderId ${writeRootId}.`;
    throw error;
  }
}

function errorPayload(error) {
  return {
    ok: false,
    error: {
      code: error.code || 'ERROR',
      message: error.message,
      ...(error.suggestion ? { suggestion: error.suggestion } : {})
    }
  };
}

function writeJsonOutput(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function isRemoteId(value) {
  return typeof value === 'string' && /^-?\d+$/.test(value);
}

function validateLocalPath(localPath) {
  const resolved = path.resolve(localPath);
  if (resolved === '/' || resolved === '/etc' || resolved.startsWith('/etc/')) {
    const error = new Error('localPath is outside the allowed workspace.');
    error.code = 'DENIED_LOCAL_PATH';
    throw error;
  }
  if (!fs.existsSync(resolved)) {
    const error = new Error(`localPath does not exist: ${localPath}`);
    error.code = 'LOCAL_PATH_NOT_FOUND';
    throw error;
  }
  return resolved;
}

module.exports = {
  SAFE_COMMANDS,
  assertCommandAllowed,
  assertWriteRoot,
  defaultAgentConfig,
  errorPayload,
  getAgentConfigPath,
  isAgentSafeMode,
  isRemoteId,
  loadAgentConfig,
  resolveAgentContext,
  saveAgentConfig,
  validateLocalPath,
  writeJsonOutput
};
