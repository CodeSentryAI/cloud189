const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const {
  assertCommandAllowed,
  assertWriteRoot,
  resolveAgentContext,
  saveAgentConfig
} = require('../src/agent-safe');

test('agent-safe mode denies dangerous commands', () => {
  const context = resolveAgentContext({ mode: 'agent-safe' }, {});

  assert.throws(() => assertCommandAllowed('rm', context), {
    code: 'DENIED_AGENT_SAFE'
  });
  assert.doesNotThrow(() => assertCommandAllowed('upload-safe', context));
});

test('agent context prefers CLI options over environment and config', () => {
  const home = path.join(os.tmpdir(), `cloud189-agent-${Date.now()}`);
  const env = {
    CLOUD189_AGENT_HOME: home,
    CLOUD189_MODE: 'agent-safe',
    CLOUD189_AGENT_NAME: 'env-agent',
    CLOUD189_WRITE_ROOT_ID: 'env-root'
  };
  saveAgentConfig({
    provider: 'cloud189',
    mode: 'user',
    agent: { name: 'config-agent', writeRootId: 'config-root' }
  }, env);

  const context = resolveAgentContext({
    mode: 'user',
    agent: 'cli-agent',
    writeRootId: 'cli-root'
  }, env);

  assert.equal(context.mode, 'user');
  assert.equal(context.agent.name, 'cli-agent');
  assert.equal(context.agent.writeRootId, 'cli-root');
});

test('write root guard only allows the configured root', () => {
  const context = resolveAgentContext({
    mode: 'agent-safe',
    writeRootId: '123'
  }, {});

  assert.doesNotThrow(() => assertWriteRoot('123', context));
  assert.throws(() => assertWriteRoot('456', context), {
    code: 'DENIED_WRITE_ROOT'
  });
});
