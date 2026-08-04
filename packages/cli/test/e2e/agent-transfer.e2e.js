#!/usr/bin/env node
'use strict';

// E2E transfer tests for an AGENT (agent-safe mode).
//
// The agent only gets the safe command set (upload-safe, sync-upload-safe,
// download, ...) and may only write inside the write root created by
// init-agent. Covers: small file, large file (split upload), small dir
// (sync-upload-safe, including idempotency), large dir (large files split
// inside the write root), and a dir bundle produced by upload-safe.
//
// Requires a real Cloud189 account: an existing `cloud189 login` session, or
// CLOUD189_E2E_USERNAME / CLOUD189_E2E_PASSWORD. The agent config is isolated
// in a temp CLOUD189_AGENT_HOME; "large" thresholds are forced small by
// helpers.js defaults (override via CLOUD189_* env vars, fixture sizes adapt
// through e2eSizes()).

const fs = require('fs');
const path = require('path');

const {
  buildFixtureDir,
  ensureLoggedIn,
  e2eSizes,
  runCli,
  runId,
  sha256File,
  tmpDir,
  verifyTree,
  writeFixtureFile
} = require('./helpers');

function agentEnv(agentHome, writeRootId) {
  return {
    CLOUD189_AGENT_HOME: agentHome,
    CLOUD189_MODE: 'agent-safe',
    CLOUD189_WRITE_ROOT_ID: writeRootId
  };
}

function main() {
  const work = tmpDir('cloud189-e2e-agent');
  const agentHome = tmpDir('cloud189-e2e-agent-home');
  const report = [];
  const failures = [];
  let writeRootId = null;

  function check(condition, message) {
    if (condition) {
      report.push(`[PASS] ${message}`);
    } else {
      failures.push(message);
      report.push(`[FAIL] ${message}`);
    }
  }

  try {
    ensureLoggedIn('agent transfer');

    const agentName = `e2e-agent-${runId('run')}`;
    const init = runCli(['init-agent', agentName, '--json'], { env: { CLOUD189_AGENT_HOME: agentHome } });
    check(init.code === 0, 'init-agent exits 0');
    writeRootId = init.payload && init.payload.writeRootId;
    check(Boolean(writeRootId), 'init-agent returns writeRootId');
    if (!writeRootId) {
      throw new Error('no write root, cannot continue');
    }
    report.push(`agent write root folder: ${writeRootId}`);

    const env = agentEnv(agentHome, writeRootId);
    const status = runCli(['agent-status', '--json'], { env });
    check(
      status.code === 0 && status.payload && status.payload.mode === 'agent-safe' && status.payload.canUploadSafe === true,
      'agent-status reports agent-safe mode with upload rights'
    );

    const sizes = e2eSizes();
    report.push(`effective thresholds: chunk=${sizes.chunk} threshold=${sizes.threshold} bundleFileCount=${sizes.bundleFileCount}`);

    // -- small file via upload-safe --
    {
      const caseDir = path.join(work, 'small-file');
      fs.mkdirSync(caseDir, { recursive: true });
      const fixture = writeFixtureFile(caseDir, 'payload.bin', sizes.small);
      const up = runCli(['upload-safe', fixture.abs, writeRootId, '--json'], { env });
      check(up.code === 0, 'agent small file: upload-safe exits 0');
      const remoteFileId = up.payload && up.payload.uploaded && up.payload.uploaded[0] && up.payload.uploaded[0].remoteFileId;
      check(Boolean(remoteFileId), 'agent small file: upload-safe returns remoteFileId');
      if (remoteFileId) {
        const dlPath = path.join(caseDir, 'dl', 'payload.bin');
        const dl = runCli(['download', remoteFileId, dlPath], { env });
        check(dl.code === 0, 'agent small file: download exits 0');
        check(fs.existsSync(dlPath) && sha256File(dlPath) === fixture.sha256, 'agent small file: round-trip checksum matches');
      }
    }

    // -- large file via upload-safe (split upload inside write root) --
    {
      const caseDir = path.join(work, 'large-file');
      fs.mkdirSync(caseDir, { recursive: true });
      const fixture = writeFixtureFile(caseDir, 'large.bin', sizes.large);
      const up = runCli(['upload-safe', fixture.abs, writeRootId, '--json'], { env });
      check(up.code === 0, 'agent large file: upload-safe exits 0');
      const item = up.payload && up.payload.uploaded && up.payload.uploaded[0];
      check(Boolean(item && item.split && item.remoteFolderId), 'agent large file: upload-safe splits large file');
      if (item && item.remoteFolderId) {
        const dlDir = path.join(caseDir, 'dl');
        fs.mkdirSync(dlDir, { recursive: true });
        const dl = runCli(['download', item.remoteFolderId, dlDir, '--dir'], { env });
        check(dl.code === 0, 'agent large file: split download exits 0');
        const joined = path.join(dlDir, 'large.bin');
        check(fs.existsSync(joined) && sha256File(joined) === fixture.sha256, 'agent large file: round-trip checksum matches (chunked)');
      }
    }

    // -- small dir via sync-upload-safe (and idempotent second pass) --
    {
      const caseDir = path.join(work, 'small-dir');
      const src = buildFixtureDir(path.join(caseDir, 'src'), {
        'note.txt': sizes.small,
        'docs/a.md': 8192,
        'docs/sub/b.md': 16384,
        'assets/icon.png': 32768
      });
      const up1 = runCli(['sync-upload-safe', src.root, writeRootId, '--once', '--json'], { env });
      check(up1.code === 0, 'agent small dir: sync-upload-safe pass 1 exits 0');
      const uploaded1 = up1.payload && up1.payload.uploaded ? up1.payload.uploaded.length : -1;
      check(uploaded1 === src.files.length, `agent small dir: pass 1 uploads every file (${uploaded1}/${src.files.length})`);
      const up2 = runCli(['sync-upload-safe', src.root, writeRootId, '--once', '--json'], { env });
      const uploaded2 = up2.payload && up2.payload.uploaded ? up2.payload.uploaded.length : -1;
      check(up2.code === 0 && uploaded2 === 0, `agent small dir: pass 2 uploads nothing (${uploaded2} re-uploaded)`);
      const dlRoot = path.join(caseDir, 'dl');
      const dl = runCli(['download', writeRootId, dlRoot, '--dir'], { env });
      check(dl.code === 0, 'agent small dir: write-root download exits 0');
      const treeFailures = verifyTree(src.files, dlRoot);
      check(treeFailures.length === 0, `agent small dir: round-trip tree intact${treeFailures.length ? ' -- ' + treeFailures.slice(0, 2).join('; ') : ''}`);
    }

    // -- large dir via sync-upload-safe (large files split inside write root) --
    {
      const caseDir = path.join(work, 'large-dir');
      const specs = {};
      for (let i = 0; i < 3; i += 1) {
        specs[`big-${i}.bin`] = sizes.large;
      }
      const src = buildFixtureDir(path.join(caseDir, 'src'), specs);
      const up = runCli(['sync-upload-safe', src.root, writeRootId, '--once', '--json'], { env });
      check(up.code === 0, 'agent large dir: sync-upload-safe exits 0');
      const uploaded = up.payload && up.payload.uploaded ? up.payload.uploaded.length : -1;
      check(uploaded === src.files.length, `agent large dir: uploads every file (${uploaded}/${src.files.length})`);
      const dlRoot = path.join(caseDir, 'dl');
      const dl = runCli(['download', writeRootId, dlRoot, '--dir'], { env });
      check(dl.code === 0, 'agent large dir: write-root download exits 0');
      const treeFailures = verifyTree(src.files, dlRoot);
      check(treeFailures.length === 0, `agent large dir: round-trip tree intact${treeFailures.length ? ' -- ' + treeFailures.slice(0, 2).join('; ') : ''}`);
    }

    // -- dir bundle via upload-safe --
    {
      const caseDir = path.join(work, 'dir-bundle');
      const specs = {};
      for (let i = 0; i < sizes.bundleFileCount + 2; i += 1) {
        specs[`chunk-${i}.bin`] = sizes.bundleMemberSize;
      }
      const src = buildFixtureDir(path.join(caseDir, 'src'), specs);
      const up = runCli(['upload-safe', src.root, writeRootId, '--json'], { env });
      check(up.code === 0, 'agent dir bundle: upload-safe exits 0');
      const item = up.payload && up.payload.uploaded && up.payload.uploaded[0];
      check(Boolean(item && item.dirBundle && item.remoteFolderId), 'agent dir bundle: upload-safe produces dir bundle');
      if (item && item.remoteFolderId) {
        const dlRoot = path.join(caseDir, 'dl');
        fs.mkdirSync(dlRoot, { recursive: true });
        const dl = runCli(['download', item.remoteFolderId, dlRoot, '--dir'], { env });
        check(dl.code === 0, 'agent dir bundle: bundle download exits 0');
        const treeFailures = verifyTree(src.files, path.join(dlRoot, src.rootName));
        check(treeFailures.length === 0, `agent dir bundle: round-trip tree intact${treeFailures.length ? ' -- ' + treeFailures.slice(0, 2).join('; ') : ''}`);
      }
    }
  } finally {
    if (writeRootId) {
      // Remote cleanup is a human privilege: run rm outside agent-safe mode.
      const rm = runCli(['rm', writeRootId, '--dir'], { env: { CLOUD189_AGENT_HOME: agentHome, CLOUD189_MODE: 'user' } });
      if (rm.code !== 0) {
        report.push(`[WARN] remote cleanup failed (write root ${writeRootId} left in place): ${rm.stderr || rm.stdout}`);
      }
    }
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(agentHome, { recursive: true, force: true });
  }

  console.log('AGENT TRANSFER E2E');
  console.log(report.join('\n'));
  if (failures.length) {
    console.error(`\n${failures.length} failure(s)`);
    process.exitCode = 1;
  } else {
    console.log('\nall agent transfer checks passed');
  }
}

main();
