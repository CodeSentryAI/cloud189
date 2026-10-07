const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('./config');

function emptyState() {
  return {
    uploads: {},
    downloads: {},
    operations: []
  };
}

// Before v2.0 the state lived in ~/.config/cloud189-cli/state.json. Read it as a
// fallback so upgrades keep their sync history (a later saveState migrates it).
function legacyStatePath(filePath) {
  const dir = path.dirname(filePath);
  if (path.basename(dir) !== 'cloud189') return null;
  const legacy = path.join(path.dirname(dir), 'cloud189-cli', path.basename(filePath));
  return legacy === filePath ? null : legacy;
}

function loadState(filePath) {
  if (!fs.existsSync(filePath)) {
    const legacy = legacyStatePath(filePath);
    if (legacy && fs.existsSync(legacy)) {
      return readJson(legacy, emptyState());
    }
  }
  return readJson(filePath, emptyState());
}

function saveState(filePath, state) {
  const next = {
    uploads: state.uploads || {},
    downloads: state.downloads || {},
    operations: (state.operations || []).slice(-50)
  };
  writeJson(filePath, next);
}

function recordOperation(state, operation) {
  state.operations = state.operations || [];
  state.operations.push({
    at: new Date().toISOString(),
    ...operation
  });
}

function hasChanged(previous, current) {
  if (!previous) return true;
  return previous.size !== current.size || previous.mtimeMs !== current.mtimeMs || previous.rev !== current.rev;
}

module.exports = {
  hasChanged,
  loadState,
  recordOperation,
  saveState
};
