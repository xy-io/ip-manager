// ============================================================
//  Secret redaction
//
//  The support bundle embeds recent journal lines so a user can share
//  diagnostics. On a recently installed or recovered server those lines still
//  contain the generated startup password, which people then paste into issues
//  and chats. Anything that looks like a credential is removed first.
// ============================================================

'use strict';

function redactSecrets(text) {
  if (!text) return text;
  return String(text)
    // "password : hunter2" from the first-run and recovery credential blocks
    .replace(/^(\s*password\s*:\s*).+$/gim, '$1[redacted]')
    // Environment-style assignments
    .replace(/^(\s*IP_MANAGER_PASSWORD\s*=).*$/gim, '$1[redacted]')
    .replace(/^(\s*(?:pass|password|secret|token|api[_-]?key)\s*[=:]\s*).+$/gim, '$1[redacted]')
    // bcrypt hashes, wherever they appear
    .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, '[redacted-hash]')
    // Bearer tokens and X-API-Key headers echoed into logs
    .replace(/(X-API-Key\s*:\s*)\S+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/g, '$1[redacted]');
}

module.exports = { redactSecrets };
