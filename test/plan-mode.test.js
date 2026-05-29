const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planActions,
  planPayload
} = require('../src/safe-storage');

test('plan payload explains dangerous delete and asks for approve or deny', () => {
  const payload = planPayload('rm', ['123']);

  assert.equal(payload.ok, true);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.planMode, true);
  assert.equal(payload.requiresUserDecision, true);
  assert.match(payload.summary, /PLAN MODE/);
  assert.match(payload.intent, /delete remote item 123/);
  assert.match(payload.potentialImpact, /permanently remove/i);
  assert.deepEqual(payload.userChoices, ['approve', 'deny']);
  assert.deepEqual(payload.actions, planActions('rm', ['123']));
});

test('plan payload explains overwrite risk for raw upload', () => {
  const payload = planPayload('upload', ['./report.md', '456']);

  assert.match(payload.intent, /upload .*report.md.*456/);
  assert.match(payload.potentialImpact, /overwrite/i);
  assert.equal(payload.safeAlternative, 'Use upload-safe to refuse same-name conflicts automatically.');
});

test('plan payload rejects unsupported dangerous command', () => {
  assert.throws(() => planPayload('unknown', ['1']), {
    code: 'UNKNOWN_PLAN'
  });
});
