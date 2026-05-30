const SECRET_KEYS = new Set([
  'cookie', 'cookies', 'session', 'sessionkey', 'accesstoken',
  'refreshtoken', 'authorization', 'set-cookie', 'token',
  'ssid', 'password', 'passwd', 'secret', 'privatekey'
]);

const COOKIE_RE = /(?:cookie|cookies|set-cookie)\s*[:=]\s*[^\s;"]+/gi;
const TOKEN_RE = /(?:Bearer|Token|ssion|sessionKey|accessToken|refreshToken)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const LONG_B64_RE = /"[A-Za-z0-9+/=]{32,}"/g;

function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'object') return redactObject(value);
  return value;
}

function redactString(str) {
  if (typeof str !== 'string') return str;
  let out = str;
  out = out.replace(COOKIE_RE, (m) => {
    const idx = m.indexOf(':');
    const sep = idx >= 0 ? m.slice(idx, idx + 1) : '=';
    return m.slice(0, m.indexOf(sep) + 1) + ' [REDACTED]';
  });
  out = out.replace(TOKEN_RE, (m) => {
    const parts = m.split(/\s+/);
    return parts[0] + ' [REDACTED]';
  });
  out = out.replace(LONG_B64_RE, '"[REDACTED]"');
  return out;
}

function redactObject(obj) {
  if (Array.isArray(obj)) return obj.map(redact);
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SECRET_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof val === 'string') {
      result[key] = redactString(val);
    } else if (typeof val === 'object' && val !== null) {
      result[key] = redactObject(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function maskAccount(account) {
  if (!account) return 'unknown';
  if (account.includes('@')) {
    const [user, domain] = account.split('@');
    return user.slice(0, 2) + '***@' + domain;
  }
  if (/^\d+$/.test(account) && account.length > 7) {
    return account.slice(0, 3) + '****' + account.slice(-4);
  }
  if (account.length > 4) {
    return account.slice(0, 2) + '***' + account.slice(-2);
  }
  return '***';
}

module.exports = { redact, redactString, redactObject, maskAccount };
