const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { walkFiles } = require('../fs-utils');
const { loadPolicy, classifyPath } = require('./policy');
const { scanFile } = require('./scanner');
const { createRedactedCopy, cleanupRedacted } = require('./redactor');
const { logEvent } = require('./audit');

const SEVERITY_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };

function severityOf(findings) {
  let max = 'low';
  for (const f of findings) {
    if (SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[max]) max = f.severity;
  }
  return max;
}

function defaultActionFor(severity, mode, policy) {
  if (severity === 'critical') return 'deny';
  if (severity === 'high') return 'deny';
  if (mode === 'interactive') return policy.defaultInteractiveAction; // 'ask'
  if (mode === 'mcp') return policy.defaultMcpAction; // 'deny'
  return policy.defaultNonInteractiveAction; // 'deny'
}

function allowedActionsFor(severity, mode, policy) {
  const actions = ['deny'];
  if (policy.replace.enabled) actions.push('replace');
  if (mode === 'interactive') {
    actions.push('approve');
  } else if (mode === 'mcp' && policy.allowMcpOriginalSensitiveUpload) {
    actions.push('approve');
  }
  return actions;
}

function sanitizeFindings(findings) {
  // Never leak raw secret values
  return findings.map(f => ({
    type: f.type,
    severity: f.severity,
    file: f.file,
    ...(f.line ? { line: f.line } : {}),
    name: f.name,
    ...(f.pattern ? { pattern: f.pattern } : {}),
  }));
}

function guardSingleFile(filePath, policy, mode) {
  const resolved = path.resolve(filePath);

  // Path classification
  const pathHit = classifyPath(resolved, policy);
  let findings = [];

  if (pathHit) {
    findings.push({
      type: pathHit.type,
      severity: pathHit.severity,
      file: resolved,
      pattern: pathHit.pattern,
      message: '[' + pathHit.type + '] ' + pathHit.pattern
    });
  }

  // Content scan
  const contentFindings = scanFile(resolved, policy);
  findings = findings.concat(contentFindings);

  const severity = severityOf(findings);
  const safe = findings.length === 0;
  const recommendedAction = defaultActionFor(severity, mode, policy);
  const allowedActions = allowedActionsFor(severity, mode, policy);

  return {
    file: resolved,
    safe,
    findings,
    severity,
    recommendedAction,
    allowedActions
  };
}

function scanDirectory(dirPath, policy, mode) {
  const results = [];
  const resolved = path.resolve(dirPath);
  for (const filePath of walkFiles(resolved)) {
    results.push(guardSingleFile(filePath, policy, mode));
  }
  return results;
}

async function guardBeforeUpload(localPath, options) {
  const {
    mode = 'non-interactive',
    policyFile,
    onSensitive,
    forceSensitive = false,
    wantsJson = false,
    actor = 'cli'
  } = options;

  const policy = loadPolicy(policyFile);

  if (!policy.enabled) {
    return { decision: 'approve', findings: [], safe: true };
  }

  if (forceSensitive && mode === 'interactive') {
    // Even with force, log a warning-level scan
    const stat = fs.statSync(localPath);
    let findings = [];
    if (stat.isFile()) {
      findings = guardSingleFile(localPath, policy, mode).findings;
    } else {
      const dirResults = scanDirectory(localPath, policy, mode);
      for (const r of dirResults) findings = findings.concat(r.findings);
    }
    return { decision: 'approve', findings: sanitizeFindings(findings), safe: false, forced: true };
  }

  if (forceSensitive && mode !== 'interactive') {
    const err = new Error('--force-sensitive requires interactive mode');
    err.code = 'FORCE_REQUIRES_INTERACTIVE';
    throw err;
  }

  let fileResults;
  const stat = fs.statSync(localPath);
  if (stat.isFile()) {
    fileResults = [guardSingleFile(localPath, policy, mode)];
  } else {
    fileResults = scanDirectory(localPath, policy, mode);
  }

  const safeResults = fileResults.filter(r => r.safe);
  const riskyResults = fileResults.filter(r => !r.safe);

  if (riskyResults.length === 0) {
    return { decision: 'approve', findings: [], safe: true };
  }

  // Determine overall recommended action
  let worstSeverity = 'low';
  for (const r of fileResults) {
    if (SEVERITY_ORDER[r.severity] > SEVERITY_ORDER[worstSeverity]) worstSeverity = r.severity;
  }

  const recommendedAction = onSensitive
    ? onSensitive
    : defaultActionFor(worstSeverity, mode, policy);

  const allowedActions = allowedActionsFor(worstSeverity, mode, policy);

  const allFindings = [];
  for (const r of riskyResults) allFindings.push(...r.findings);

  const sanitizedFindings = sanitizeFindings(allFindings);
  const blockedFiles = [...new Set(riskyResults.map(r => r.file))];

  // --- MCP / non-interactive: deny by default ---
  if (mode === 'mcp' || mode === 'non-interactive') {
    const decision = (recommendedAction === 'replace' && policy.replace.enabled) ? 'replace' : 'deny';
    logEvent({
      event: 'upload_blocked',
      file: localPath,
      reason: blockedFiles.map(f => {
        const r = riskyResults.find(x => x.file === f);
        return r ? r.findings.map(fi => fi.type + (fi.name ? ':' + fi.name : '')).join(',') : 'unknown';
      }),
      actor,
      decision,
      mode
    });
    return {
      decision,
      findings: sanitizedFindings,
      safe: false,
      blockedFiles,
      allowedActions,
      recommendedAction
    };
  }

  // --- Interactive: prompt ---
  const criticalFindings = allFindings.filter(f => f.severity === 'critical');
  const highFindings = allFindings.filter(f => f.severity === 'high');

  console.log('');
  console.log('\x1b[31mData Leak Guard found sensitive content:\x1b[0m');
  for (const f of sanitizedFindings.slice(0, 20)) {
    const loc = f.line ? `:${f.line}` : '';
    console.log(`  [${f.severity}] ${path.basename(f.file)}${loc} — ${f.type}${f.name ? ' (' + f.name + ')' : ''}`);
  }
  if (sanitizedFindings.length > 20) {
    console.log(`  ... and ${sanitizedFindings.length - 20} more findings`);
  }
  console.log('');

  let choices = '';
  const choiceLabels = [];

  if (allowedActions.includes('approve')) {
    if (criticalFindings.length > 0) {
      choices += '[A] Approve original (requires typing I UNDERSTAND UPLOAD SECRET)\n';
    } else {
      choices += '[A] Approve original\n';
    }
    choiceLabels.push('A');
  }
  choices += '[D] Deny / skip\n';
  choiceLabels.push('D');
  if (allowedActions.includes('replace') && policy.replace.enabled) {
    choices += '[R] Replace secrets with *** and upload redacted copy\n';
    choiceLabels.push('R');
  }

  console.log(choices);
  const defaultChoice = recommendedAction === 'replace' ? 'R' : 'D';
  console.log(`Select [${defaultChoice}]:`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => {
    rl.once('line', line => { rl.close(); resolve(line.trim().toUpperCase()); });
  });

  let decision;
  if (choiceLabels.includes(answer)) {
    decision = answer === 'A' ? 'approve' : answer === 'R' ? 'replace' : 'deny';
  } else {
    decision = recommendedAction;
  }

  // Critical require explicit confirmation
  if (decision === 'approve' && criticalFindings.length > 0) {
    if (answer === 'A') {
      // Shortcut: single 'A' with critical findings requires typed phrase
      console.log('\nThis file contains CRITICAL findings (private keys).');
      console.log('Type "I UNDERSTAND UPLOAD SECRET" to confirm:');
      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      const confirm = await new Promise(resolve => {
        rl2.once('line', line => { rl2.close(); resolve(line.trim()); });
      });
      if (confirm !== 'I UNDERSTAND UPLOAD SECRET') {
        console.log('Confirmation failed. Defaulting to deny.');
        decision = 'deny';
      }
    }
  }

  logEvent({
    event: 'upload_decision',
    file: localPath,
    reason: blockedFiles,
    actor,
    decision,
    mode
  });

  if (decision === 'deny') {
    return { decision: 'deny', findings: sanitizedFindings, safe: false, blockedFiles, allowedActions };
  }

  if (decision === 'replace') {
    // Build a map of redacted paths
    const redactedMap = {};
    for (const r of riskyResults) {
      const redactedPath = createRedactedCopy(r.file, r.findings, policy.replace.replacement);
      if (redactedPath !== r.file) {
        redactedMap[r.file] = redactedPath;
      }
    }
    return { decision: 'replace', findings: sanitizedFindings, safe: false, redactedMap, blockedFiles, allowedActions };
  }

  return { decision: "approve", findings: sanitizedFindings, safe: false, forced: false, blockedFiles, allowedActions };
}

module.exports = {
  guardBeforeUpload,
  guardSingleFile,
  scanDirectory,
  sanitizeFindings
};
