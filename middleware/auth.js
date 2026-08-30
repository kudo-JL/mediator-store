// middleware/auth.js
const { db } = require('../lib/db');

function loadAdmin(req, res, next) {
  res.locals.currentAdmin = null;
  if (req.session && req.session.adminId) {
    const row = db.prepare('SELECT id, username FROM admins WHERE id = ?').get(req.session.adminId);
    if (row) res.locals.currentAdmin = row;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (res.locals.currentAdmin) return next();
  if (req.accepts('html')) {
    return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  return res.status(401).json({ error: 'unauthorized' });
}

module.exports = { loadAdmin, requireAdmin };
