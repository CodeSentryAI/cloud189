const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { guardSingleFile, sanitizeFindings } = require('../src/security/data-leak-guard');
const { classifyPath, loadPolicy } = require('../src/security/policy');
const { scanFile } = require('../src/security/scanner');
const { createRedactedCopy, cleanupRedacted } = require('../src/security/redactor');
const { logEvent } = require('../src/security/audit');

const POLICY = loadPolicy();

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-test-'));
}

describe('policy: classifyPath', () => {
  it('blocks ~/.ssh/id_rsa', () => {
    const policy = loadPolicy();
    const hit = classifyPath(path.join(os.homedir(), '.ssh', 'id_rsa'), policy);
    assert.ok(hit);
    assert.equal(hit.type, 'forbidden_path');
  });

  it('blocks ~/.hermes/.env', () => {
    const hit = classifyPath(path.join(os.homedir(), '.hermes', '.env'), POLICY);
    assert.ok(hit);
  });

  it('blocks project .env files', () => {
    const tmp = tmpDir();
    fs.writeFileSync(path.join(tmp, '.env'), 'FOO=bar');
    assert.ok(classifyPath(path.join(tmp, '.env'), POLICY));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('blocks .pem files', () => {
    const tmp = tmpDir();
    fs.writeFileSync(path.join(tmp, 'cert.pem'), '-----BEGIN CERTIFICATE-----');
    assert.ok(classifyPath(path.join(tmp, 'cert.pem'), POLICY));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('flags .npmrc as suspicious', () => {
    const tmp = tmpDir();
    const f = path.join(tmp, '.npmrc');
    fs.writeFileSync(f, '//r/:_authToken=abc');
    const hit = classifyPath(f, POLICY);
    assert.ok(hit);
    assert.equal(hit.type, 'suspicious_path');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('allows normal project files', () => {
    const tmp = tmpDir();
    const f = path.join(tmp, 'report.md');
    fs.writeFileSync(f, '# Hello');
    assert.equal(classifyPath(f, POLICY), null);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('respects allowPaths', () => {
    const tmp = tmpDir();
    const f = path.join(tmp, 'example.env');
    fs.writeFileSync(f, 'FOO=bar');
    const policy = Object.assign({}, POLICY, { allowPaths: [f] });
    assert.equal(classifyPath(f, policy), null);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('scanner: content patterns', () => {
  let tmp;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

  function write(name, content) {
    return fs.writeFileSync(path.join(tmp, name), content, 'utf8') || path.join(tmp, name);
  }

  it('detects openai-style key in text', () => {
    const p = write('config.env', 'API_KEY=supersecretvalue123456789');
    const findings = scanFile(p, POLICY);
    assert.ok(findings.length > 0, 'should find pattern in .env file');
  });

  it('detects AWS access key', () => {
    const p = write('aws.txt', 'AKIAIOSFODNN7EXAMPLE');
    const findings = scanFile(p, POLICY);
    assert.ok(findings.some(f => f.name === 'aws_access_key_id'));
  });

  it('detects password assignment', () => {
    const p = write('config.yml', 'password: mysecretpassword123');
    const findings = scanFile(p, POLICY);
    assert.ok(findings.some(f => f.name === 'password_assignment'));
  });

  it('flags archive files', () => {
    const p = path.join(tmp, 'archive.zip');
    fs.writeFileSync(p, 'PKfake');
    const findings = scanFile(p, POLICY);
    assert.ok(findings.some(f => f.type === 'binary_or_archive'));
  });
});

describe('guardSingleFile', () => {
  let tmp;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it('returns safe=true for normal files', () => {
    const p = path.join(tmp, 'report.md');
    fs.writeFileSync(p, '# Hello World');
    const result = guardSingleFile(p, POLICY, 'mcp');
    assert.equal(result.safe, true);
    assert.equal(result.findings.length, 0);
  });

  it('returns safe=false for file with API key', () => {
    const p = path.join(tmp, 'keys.txt');
    fs.writeFileSync(p, 'MY_API_KEY=supersecretvalue123456789');
    const result = guardSingleFile(p, POLICY, 'mcp');
    assert.equal(result.safe, false);
    assert.ok(result.findings.length > 0);
  });

  it('mcp: only deny+replace for critical files', () => {
    const sshPath = path.join(os.homedir(), '.ssh');
    if (!fs.existsSync(sshPath)) fs.mkdirSync(sshPath, { recursive: true });
    const kp = path.join(sshPath, 'id_rsa_guardtest_' + process.pid);
    fs.writeFileSync(kp, '-----BEGIN RSA PRIVATE KEY-----\nMIIE');
    const result = guardSingleFile(kp, POLICY, 'mcp');
    assert.deepEqual(result.allowedActions, ['deny', 'replace']);
    fs.unlinkSync(kp);
  });

  it('interactive: allows approve for low severity paths', () => {
    const tmp = tmpDir();
    const p = path.join(tmp, '.npmrc');
    fs.writeFileSync(p, '//r/:_authToken=abc');
    const custom = Object.assign({}, POLICY, { forbiddenPaths: [] });
    const result = guardSingleFile(p, custom, 'interactive');
    assert.ok(result.allowedActions.includes('approve'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('mcp defaults to deny for suspicious paths', () => {
    const tmp = tmpDir();
    const p = path.join(tmp, '.npmrc');
    fs.writeFileSync(p, '//r/:_authToken=abc');
    const result = guardSingleFile(p, POLICY, 'mcp');
    assert.equal(result.recommendedAction, 'deny');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('redactor', () => {
  let tmp;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it('redacts secret value and keeps safe lines', () => {
    const p = path.join(tmp, '.env');
    fs.writeFileSync(p, 'HOST=localhost\nAPI_KEY=supersecretvalue123456789', 'utf8');
    const findings = [{ type: 'secret_pattern', severity: 'high', file: p, line: 2, name: 'env_api_key', pattern: 'env_api_key' }];
    const redacted = createRedactedCopy(p, findings, 'REDACTED');
    assert.notEqual(redacted, p);
    const content = fs.readFileSync(redacted, 'utf8');
    assert.ok(content.includes('HOST=localhost'), 'should keep safe lines');
    assert.ok(!content.includes('supersecretvalue123456789'), 'should not contain original');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('does not modify original file', () => {
    const tmp = tmpDir();
    const p = path.join(tmp, 'config.json');
    fs.writeFileSync(p, JSON.stringify({token: 'SECRET123'}));
    const original = fs.readFileSync(p, 'utf8');
    const findings = [{ type: 'secret_pattern', severity: 'high', file: p, line: 1, name: 'env_api_key', pattern: 'env_api_key' }];
    createRedactedCopy(p, findings, 'REDACTED');
    assert.equal(fs.readFileSync(p, 'utf8'), original);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('cleanup deletes redacted file', () => {
    const tmp = tmpDir();
    const p = path.join(tmp, '.env');
    fs.writeFileSync(p, 'KEY=VALUESECRET123');
    const findings = [{ type: 'secret_pattern', severity: 'high', file: p, line: 1, name: 'env_api_key', pattern: 'env_api_key' }];
    const redacted = createRedactedCopy(p, findings, 'REDACTED');
    assert.ok(fs.existsSync(redacted));
    cleanupRedacted(redacted);
    assert.ok(!fs.existsSync(redacted));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('audit log', () => {
  it('writes event without secrets', () => {
    const td = tmpDir();
    const logFile = path.join(td, 'audit.log');
    logEvent({ event: 'upload_blocked', file: '/home/user/.env', reason: ['forbidden_path'], actor: 'mcp', decision: 'deny' }, logFile);
    const outer = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    const entry = outer.event || outer;
    assert.equal(entry.event, 'upload_blocked');
    assert.equal(entry.actor, 'mcp');
    assert.equal(entry.decision, 'deny');
    fs.rmSync(td, { recursive: true, force: true });
  });
});

describe('sanitizeFindings', () => {
  it('strips redactedPreview', () => {
    const findings = [{ type: 'secret_pattern', severity: 'high', file: '/home/user/.env', line: 3, name: 'env_api_key', pattern: 'env_api_key', redactedPreview: '[env_api_key]' }];
    const clean = sanitizeFindings(findings);
    assert.ok(!clean[0].redactedPreview, 'should strip redactedPreview');
  });
});
