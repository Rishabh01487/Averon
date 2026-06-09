const C = require('../config/constants');
const { logAudit } = require('./audit');

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }
  if (req.user.role !== C.ROLES.ADMIN && req.user.role !== C.ROLES.AUDITOR) {
    logAudit('ADMIN_ACTION_DENIED', { attemptedPath: req.path }, { userId: req.user.userId, ip: req.ip });
    return res.status(403).json({ error: 'Admin access required', code: 'ADMIN_REQUIRED' });
  }
  next();
}

function requireAuditor(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }
  if (req.user.role !== C.ROLES.AUDITOR) {
    return res.status(403).json({ error: 'Auditor access required', code: 'AUDITOR_REQUIRED' });
  }
  next();
}

module.exports = { requireAdmin, requireAuditor };
