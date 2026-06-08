// ══════════════════════════════════════════════════════════════════════════════
// AVERON AUDIT MIDDLEWARE — Tamper-proof audit logging
// Every audit entry is hash-chained to the previous, making it immutable.
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

let _db = null;
let _lastHash = '0000000000000000000000000000000000000000000000000000000000000000';

function initAudit(database) {
  _db = database;
  // Load the last hash from the audit log
  const last = _db.queryOne('SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1');
  if (last) _lastHash = last.entry_hash;
}

function computeEntryHash(entry, prevHash) {
  const data = `${prevHash}:${entry.user_id}:${entry.action}:${entry.resource_type}:${entry.resource_id}:${entry.created_at}:${JSON.stringify(entry.details)}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Log an audit entry with tamper-proof hash chain.
 */
function logAudit(action, details = {}, options = {}) {
  if (!_db) return;

  const entry = {
    user_id: options.userId || '',
    action,
    resource_type: options.resourceType || '',
    resource_id: String(options.resourceId || ''),
    details: JSON.stringify(details),
    ip_address: options.ip || '',
    user_agent: options.userAgent || '',
    request_method: options.method || '',
    request_path: options.path || '',
    response_code: options.responseCode || 0,
    created_at: Date.now(),
  };

  entry.prev_hash = _lastHash;
  entry.entry_hash = computeEntryHash(entry, _lastHash);
  _lastHash = entry.entry_hash;

  _db.run(
    `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address, user_agent, request_method, request_path, response_code, prev_hash, entry_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [entry.user_id, entry.action, entry.resource_type, entry.resource_id, entry.details,
     entry.ip_address, entry.user_agent, entry.request_method, entry.request_path,
     entry.response_code, entry.prev_hash, entry.entry_hash, entry.created_at]
  );

  return entry;
}

/**
 * Express middleware that auto-logs all state-changing requests.
 */
function auditMiddleware(req, res, next) {
  // Only audit state-changing methods
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const originalSend = res.send;
    res.send = function (body) {
      // Log after response is sent
      const action = inferAction(req.method, req.path);
      if (action) {
        logAudit(action, {
          body: sanitizeBodyForAudit(req.body),
          params: req.params,
          query: req.query,
        }, {
          userId: req.user?.userId || '',
          ip: req.ip || '',
          userAgent: req.headers['user-agent'] || '',
          method: req.method,
          path: req.path,
          responseCode: res.statusCode,
        });
      }
      return originalSend.call(this, body);
    };
  }
  next();
}

/**
 * Verify the integrity of the audit chain.
 */
function verifyAuditChain() {
  if (!_db) return { valid: false, error: 'Database not initialized' };

  const entries = _db.query('SELECT * FROM audit_log ORDER BY id ASC');
  if (entries.length === 0) return { valid: true, entries: 0 };

  let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';