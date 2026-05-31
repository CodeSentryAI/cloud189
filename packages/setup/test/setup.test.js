const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('default policy ships as JSON with deny-by-default settings', () => {
  const policyPath = path.join(__dirname, '..', 'src', 'default-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

  assert.equal(policy.enabled, true);
  assert.equal(policy.defaultInteractiveAction, 'ask');
  assert.equal(policy.defaultNonInteractiveAction, 'deny');
  assert.equal(policy.defaultMcpAction, 'deny');
  assert.ok(Array.isArray(policy.forbiddenPaths));
  assert.ok(policy.forbiddenPaths.includes('**/.env'));
});

test('setup script includes work-results folder and canonical policy path', () => {
  const scriptPath = path.join(__dirname, '..', 'bin', 'cloud189-setup.js');
  const script = fs.readFileSync(scriptPath, 'utf8');

  assert.match(script, /work-results/);
  assert.match(script, /policy\.json/);
  assert.match(script, /installPublishedPackage/);
});