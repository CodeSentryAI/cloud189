const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { getConfigDir, getStatePath, getTokenPath } = require('../src/config');

test('config paths honor CLOUD189_CLI_HOME', () => {
  const env = { CLOUD189_CLI_HOME: '/tmp/cloud189-test' };

  assert.equal(getConfigDir(env), '/tmp/cloud189-test');
  assert.equal(getTokenPath(getConfigDir(env)), path.join('/tmp/cloud189-test', 'token.json'));
  assert.equal(getStatePath(getConfigDir(env)), path.join('/tmp/cloud189-test', 'state.json'));
});
