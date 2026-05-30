const { readJson, writeJson } = require('./config');

function loadState(filePath) {
  return readJson(filePath, {
    uploads: {},
    downloads: {},
    operations: []
  });
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
