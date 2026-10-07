const { describe, it, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Keep guard audit logs out of the developer's real config directory.
const GUARD_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud189-guard-home-'));
process.env.CLOUD189_HOME = GUARD_HOME;
after(() => { try { fs.rmSync(GUARD_HOME, { recursive: true, force: true }); } catch {} });

const { guardSingleFile, guardBeforeUpload, sanitizeFindings } = require('../src/security/data-leak-guard');
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

  it('blocks nested ~/.hermes/**/*.env files', () => {
    const hit = classifyPath(path.join(os.homedir(), '.hermes', 'project', 'config.env'), POLICY);
    assert.ok(hit);
    assert.equal(hit.type, 'forbidden_path');
  });

  it('blocks nested ~/.claude/**/*.json files', () => {
    const hit = classifyPath(path.join(os.homedir(), '.claude', 'projects', 'settings.json'), POLICY);
    assert.ok(hit);
    assert.equal(hit.type, 'forbidden_path');
  });

  it('matches secret-bearing names case-insensitively', () => {
    const policy = { ...POLICY, forbiddenPaths: ['**/*token*'], suspiciousPaths: [], allowPaths: [] };
    assert.ok(classifyPath('/tmp/MyTokenFile.txt', policy));
  });

  it('classifies a symlink by its realpath too', () => {
    const dir = tmpDir();
    const targetDir = path.join(dir, 'real-secret');
    fs.mkdirSync(targetDir);
    const target = path.join(targetDir, 'data.json');
    fs.writeFileSync(target, '{}', 'utf8');
    const link = path.join(dir, 'innocent.json');
    try {
      fs.symlinkSync(target, link);
    } catch {
      fs.rmSync(dir, { recursive: true, force: true });
      return; // symlinks unavailable on this platform
    }
    const policy = { ...POLICY, forbiddenPaths: ['**/real-secret/**'], suspiciousPaths: [], allowPaths: [] };
    const hit = classifyPath(link, policy);
    assert.ok(hit, 'symlink target must be classified');
    assert.equal(hit.type, 'forbidden_path');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('blocks **/secrets/** directories', () => {
    const hit = classifyPath(path.join(os.tmpdir(), 'proj', 'secrets', 'token.txt'), POLICY);
    assert.ok(hit);
    assert.equal(hit.type, 'forbidden_path');
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

  it('detects JSON secret assignments', () => {
    const p = write('config.json', JSON.stringify({ token: 'opaquevalue12345678', name: 'x' }));
    const findings = scanFile(p, POLICY);
    assert.ok(findings.some(f => f.name === 'json_secret_assignment'));
  });

  it('detects concatenated env keyword spellings', () => {
    const a = write('apikey.txt', 'APIKEY=supersecretvalue12345678');
    const b = write('aws.txt', 'SECRETACCESSKEY=supersecretvalue12345678');
    assert.ok(scanFile(a, POLICY).some(f => f.name === 'env_api_key'));
    assert.ok(scanFile(b, POLICY).some(f => f.name === 'env_api_key'));
  });

  it('detects camelCase JSON secret keys', () => {
    const p = write('camel.json', JSON.stringify({ secretAccessKey: 'opaquevalue12345678' }));
    assert.ok(scanFile(p, POLICY).some(f => f.name === 'json_secret_assignment'));
  });

  it('does not flag camelCase lookalike keys', () => {
    const p = write('safe.json', JSON.stringify({ tokenizerMode: 'abcdefgh12345', secretaryName: 'alexandra123' }));
    assert.equal(scanFile(p, POLICY).length, 0);
  });

  it('detects registry auth blobs', () => {
    const p = write('docker.json', JSON.stringify({ auths: { reg: { auth: 'dXNlcjpwYXNzd29yZA==' } } }));
    assert.ok(scanFile(p, POLICY).some(f => f.name === 'registry_auth_blob'));
  });

  it('does not flag env placeholder references', () => {
    const p = write('config.yml', 'API_KEY: ${GITHUB_API_KEY}');
    const findings = scanFile(p, POLICY);
    assert.equal(findings.length, 0);
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

describe('guardBeforeUpload: mcp policy knobs', () => {
  let tmp;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

  function writePolicy(overrides) {
    const policyPath = path.join(tmp, 'policy.json');
    fs.writeFileSync(policyPath, JSON.stringify(overrides), 'utf8');
    return policyPath;
  }

  it('denies by default and honors allowMcpOriginalSensitiveUpload', async () => {
    const file = path.join(tmp, '.npmrc');
    fs.writeFileSync(file, '//registry/:_authToken=abc', 'utf8');

    const denied = await guardBeforeUpload(file, { mode: 'mcp', policyFile: writePolicy({}) });
    assert.equal(denied.decision, 'deny');

    const allowed = await guardBeforeUpload(file, {
      mode: 'mcp',
      policyFile: writePolicy({ defaultMcpAction: 'approve', allowMcpOriginalSensitiveUpload: true })
    });
    assert.equal(allowed.decision, 'approve');
  });

  it('still denies high-severity secrets even with an approve policy', async () => {
    const file = path.join(tmp, 'keys.txt');
    fs.writeFileSync(file, 'MY_API_KEY=supersecretvalue123456789', 'utf8');

    const result = await guardBeforeUpload(file, {
      mode: 'mcp',
      policyFile: writePolicy({ defaultMcpAction: 'approve', allowMcpOriginalSensitiveUpload: true })
    });
    assert.equal(result.decision, 'deny');
  });

  it('non-interactive replace returns a redacted copy and hides the secret', async () => {
    const file = path.join(tmp, 'keys.txt');
    fs.writeFileSync(file, 'MY_API_KEY=supersecretvalue123456789', 'utf8');

    const result = await guardBeforeUpload(file, { mode: 'non-interactive', onSensitive: 'replace' });

    assert.equal(result.decision, 'replace');
    const redacted = Object.values(result.redactedMap)[0];
    assert.ok(redacted, 'should have a redacted copy');
    assert.ok(!fs.readFileSync(redacted, 'utf8').includes('supersecretvalue123456789'));
  });

  it('falls back to deny when replace cannot redact anything', async () => {
    const file = path.join(tmp, '.env');
    fs.writeFileSync(file, 'FOO=bar\nGREETING=hello world\n', 'utf8');

    const result = await guardBeforeUpload(file, { mode: 'non-interactive', onSensitive: 'replace' });

    assert.equal(result.decision, 'deny');
    assert.equal(result.reason, 'nothing_redactable');
  });

  it('mcp defaultMcpAction replace redacts medium-severity findings', async () => {
    const file = path.join(tmp, 'notes.txt');
    fs.writeFileSync(file, 'auth = eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop\n', 'utf8');

    const result = await guardBeforeUpload(file, {
      mode: 'mcp',
      policyFile: writePolicy({ defaultMcpAction: 'replace' })
    });

    assert.equal(result.decision, 'replace');
    assert.equal(Object.keys(result.redactedMap).length, 1);
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

  it('redacts every secret on a line, not just the first', () => {
    const p = path.join(tmp, 'two.txt');
    fs.writeFileSync(p, 'FIRST_API_KEY=supersecretvalue11111111 SECOND_TOKEN=supersecretvalue22222222\n', 'utf8');
    const findings = scanFile(p, POLICY);
    const redacted = createRedactedCopy(p, findings, '***');
    const text = fs.readFileSync(redacted, 'utf8');
    assert.ok(!text.includes('supersecretvalue11111111'), 'first secret must be gone');
    assert.ok(!text.includes('supersecretvalue22222222'), 'second secret must be gone');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('redacts the whole private key block including every body line', () => {
    const p = path.join(tmp, 'id_rsa');
    const bodyLines = [
      'MIIEowIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyzABCDEF',
      'Q29udGludWF0aW9uT2ZLZXlNYXRlcmlhbDEyMzQ1Njc4OTBhYmNkZWY=',
      'RmluYWxMaW5lT2ZQcml2YXRlS2V5MTIzNDU2Nzg5MGFiY2RlZg=='
    ];
    fs.writeFileSync(p, `-----BEGIN RSA PRIVATE KEY-----\n${bodyLines.join('\n')}\n-----END RSA PRIVATE KEY-----\n`, 'utf8');
    const findings = scanFile(p, POLICY);
    const redacted = createRedactedCopy(p, findings, '***');
    const text = fs.readFileSync(redacted, 'utf8');
    for (const line of bodyLines) {
      assert.ok(!text.includes(line), `key body line must not survive: ${line}`);
    }
    assert.ok(!text.includes('PRIVATE KEY'), 'END marker must be redacted too');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes the redacted copy with 0600/0700 permissions', () => {
    const p = path.join(tmp, 'secret.txt');
    fs.writeFileSync(p, 'MY_API_KEY=supersecretvalue123456789\n', 'utf8');
    const findings = scanFile(p, POLICY);
    const redacted = createRedactedCopy(p, findings, '***');
    assert.equal(fs.statSync(redacted).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(redacted)).mode & 0o777, 0o700);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('keeps quoted values parseable after redaction', () => {
    const p = path.join(tmp, 'config.json');
    fs.writeFileSync(p, JSON.stringify({ name: 'x', token: 'opaquevalue12345678' }, null, 2));
    const findings = [{ type: 'secret_pattern', severity: 'high', file: p, line: 3, name: 'json_secret_assignment', pattern: 'json_secret_assignment' }];
    const redacted = createRedactedCopy(p, findings, '***');
    const parsed = JSON.parse(fs.readFileSync(redacted, 'utf8'));
    assert.equal(parsed.name, 'x');
    assert.equal(parsed.token, '***');
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
    const logDir = path.join(td, 'nested');
    const logFile = path.join(logDir, 'audit.log');
    logEvent({ event: 'upload_blocked', file: '/home/user/.env', reason: ['forbidden_path'], actor: 'mcp', decision: 'deny' }, logFile);
    const outer = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    const entry = outer.event || outer;
    assert.equal(entry.event, 'upload_blocked');
    assert.equal(entry.actor, 'mcp');
    assert.equal(entry.decision, 'deny');
    assert.equal(fs.statSync(logFile).mode & 0o777, 0o600, 'audit log should be 0600');
    assert.equal(fs.statSync(logDir).mode & 0o777, 0o700, 'audit dir should be 0700');
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
