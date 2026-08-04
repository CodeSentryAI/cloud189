#!/usr/bin/env node
'use strict';

// E2E transfer tests for a HUMAN CLI user (mode=user, full command set).
//
// Covers: small file, large file (split upload), small dir (loose upload +
// recursive download), large dir (dir bundle upload + restore).
//
// Requires a real Cloud189 account: an existing `cloud189 login` session, or
// CLOUD189_E2E_USERNAME / CLOUD189_E2E_PASSWORD. "Large" thresholds are
// forced small by helpers.js defaults so tests run with MB-sized fixtures;
// override the CLOUD189_* env vars to test real large sizes (fixture sizes
// are derived from them via e2eSizes()).

const fs = require('fs');
const path = require('path');

const {
  buildFixtureDir,
  ensureLoggedIn,
  e2eSizes,
  mkdirAndParseId,
  runCli,
  runId,
  sha256File,
  tmpDir,
  verifyTree,
  writeFixtureFile
} = require('./helpers');

const PERSONAL_ROOT = '-11';

function main() {
  const work = tmpDir('cloud189-e2e-human');
  const report = [];
  const failures = [];
  let rootId = null;

  function check(condition, message) {
    if (condition) {
      report.push(`[PASS] ${message}`);
    } else {
      failures.push(message);
      report.push(`[FAIL] ${message}`);
    }
  }

  try {
    ensureLoggedIn('human transfer');
    rootId = mkdirAndParseId(`e2e-human-${runId('run')}`, PERSONAL_ROOT);
    report.push(`remote test root folder: ${rootId}`);

    const sizes = e2eSizes();
    report.push(`effective thresholds: chunk=${sizes.chunk} threshold=${sizes.threshold} bundleFileCount=${sizes.bundleFileCount}`);

    // -- small file --
    {
      const caseDir = path.join(work, 'small-file');
      fs.mkdirSync(caseDir, { recursive: true });
      const fixture = writeFixtureFile(caseDir, 'payload.bin', sizes.small);
      const up = runCli(['upload', fixture.abs, rootId, '--json']);
      check(up.code === 0, 'small file: upload exits 0');
      const remoteFileId = up.payload && up.payload.uploaded && up.payload.uploaded[0] && up.payload.uploaded[0].remoteFileId;
      check(Boolean(remoteFileId), 'small file: upload returns remoteFileId');
      if (remoteFileId) {
        const dlPath = path.join(caseDir, 'dl', 'payload.bin');
        const dl = runCli(['download', remoteFileId, dlPath]);
        check(dl.code === 0, 'small file: download exits 0');
        check(fs.existsSync(dlPath) && sha256File(dlPath) === fixture.sha256, 'small file: round-trip checksum matches');
      }
    }

    // -- large file (split upload) --
    {
      const caseDir = path.join(work, 'large-file');
      fs.mkdirSync(caseDir, { recursive: true });
      const fixture = writeFixtureFile(caseDir, 'large.bin', sizes.large);
      const up = runCli(['upload-large-file', fixture.abs, rootId, '--json']);
      check(up.code === 0, 'large file: upload exits 0');
      const item = up.payload && up.payload.uploaded && up.payload.uploaded[0];
      check(Boolean(item && item.split && item.remoteFolderId), 'large file: upload produces split folder');
      if (item && item.remoteFolderId) {
        const dlDir = path.join(caseDir, 'dl');
        fs.mkdirSync(dlDir, { recursive: true });
        const dl = runCli(['download', item.remoteFolderId, dlDir, '--dir']);
        check(dl.code === 0, 'large file: split-folder download exits 0');
        const joined = path.join(dlDir, 'large.bin');
        check(fs.existsSync(joined) && sha256File(joined) === fixture.sha256, 'large file: round-trip checksum matches (chunked)');
      }
    }

    // -- small dir (loose file upload, recursive download) --
    {
      const caseDir = path.join(work, 'small-dir');
      const src = buildFixtureDir(path.join(caseDir, 'src'), {
        'note.txt': sizes.small,
        'docs/a.md': 8192,
        'docs/sub/b.md': 16384,
        'assets/icon.png': 32768
      });
      const subId = mkdirAndParseId('small-dir', rootId);
      const up = runCli(['upload', src.root, subId, '--json']);
      check(up.code === 0, 'small dir: upload exits 0');
      const uploadedCount = up.payload && up.payload.uploaded ? up.payload.uploaded.length : -1;
      check(uploadedCount === src.files.length, `small dir: uploads every file (${uploadedCount}/${src.files.length})`);
      const dlRoot = path.join(caseDir, 'dl');
      const dl = runCli(['download', subId, dlRoot, '--dir']);
      check(dl.code === 0, 'small dir: download exits 0');
      const treeFailures = verifyTree(src.files, dlRoot);
      check(treeFailures.length === 0, `small dir: round-trip tree intact${treeFailures.length ? ' -- ' + treeFailures.slice(0, 2).join('; ') : ''}`);
    }

    // -- large dir (dir bundle upload) --
    {
      const caseDir = path.join(work, 'large-dir');
      const specs = {};
      for (let i = 0; i < sizes.bundleFileCount + 2; i += 1) {
        specs[`chunk-${i}.bin`] = sizes.bundleMemberSize;
      }
      const src = buildFixtureDir(path.join(caseDir, 'src'), specs);
      const up = runCli(['upload-large-dir', src.root, rootId, '--json']);
      check(up.code === 0, 'large dir: upload exits 0');
      const item = up.payload && up.payload.uploaded && up.payload.uploaded[0];
      check(Boolean(item && item.dirBundle && item.remoteFolderId), 'large dir: upload produces dir bundle');
      if (item && item.remoteFolderId) {
        const dlRoot = path.join(caseDir, 'dl');
        fs.mkdirSync(dlRoot, { recursive: true });
        const dl = runCli(['download', item.remoteFolderId, dlRoot, '--dir']);
        check(dl.code === 0, 'large dir: bundle download exits 0');
        const treeFailures = verifyTree(src.files, path.join(dlRoot, src.rootName));
        check(treeFailures.length === 0, `large dir: round-trip tree intact${treeFailures.length ? ' -- ' + treeFailures.slice(0, 2).join('; ') : ''}`);
      }
    }
  } finally {
    if (rootId) {
      const rm = runCli(['rm', rootId, '--dir']);
      if (rm.code !== 0) {
        report.push(`[WARN] remote cleanup failed (folder ${rootId} left in place): ${rm.stderr || rm.stdout}`);
      }
    }
    fs.rmSync(work, { recursive: true, force: true });
  }

  console.log('HUMAN TRANSFER E2E');
  console.log(report.join('\n'));
  if (failures.length) {
    console.error(`\n${failures.length} failure(s)`);
    process.exitCode = 1;
  } else {
    console.log('\nall human transfer checks passed');
  }
}

main();
