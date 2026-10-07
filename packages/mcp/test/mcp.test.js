const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { server } = require('../src/mcp-server');

test('cloud189_plan round-trips JSON plans through the CLI child process', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'cloud189-test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const rmResult = await client.callTool({ name: 'cloud189_plan', arguments: { command: 'rm', args: ['-11'] } });
  assert.ok(!rmResult.isError, `unexpected error: ${JSON.stringify(rmResult)}`);
  const rmPlan = JSON.parse(rmResult.content[0].text);
  assert.equal(rmPlan.ok, true);
  assert.equal(rmPlan.dryRun, true);
  assert.equal(rmPlan.actions[0].action, 'delete');

  const renameResult = await client.callTool({
    name: 'cloud189_plan',
    arguments: { command: 'rename-file', args: ['123', 'renamed.txt'] }
  });
  assert.ok(!renameResult.isError, `unexpected error: ${JSON.stringify(renameResult)}`);
  const renamePlan = JSON.parse(renameResult.content[0].text);
  assert.equal(renamePlan.ok, true);
  assert.equal(renamePlan.actions[0].action, 'rename');
  assert.equal(renamePlan.actions[0].type, 'file');

  const outside = await client.callTool({
    name: 'cloud189_download',
    arguments: { remoteId: '123', localPath: '/etc/passwd' }
  });
  assert.equal(outside.isError, true, 'paths outside the workspace must be rejected');

  const link = path.join(os.tmpdir(), `cloud189-workspace-link-${process.pid}`);
  let linked = false;
  try {
    fs.symlinkSync(path.join(os.homedir(), '.ssh'), link, 'dir');
    linked = true;
  } catch {}
  if (linked) {
    try {
      const escape = await client.callTool({
        name: 'cloud189_download',
        arguments: { remoteId: '123', localPath: path.join(link, 'authorized_keys') }
      });
      assert.equal(escape.isError, true, 'symlink escapes must be rejected');
    } finally {
      try { fs.unlinkSync(link); } catch {}
    }
  }

  await client.close();
});
