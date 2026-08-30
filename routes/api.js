// routes/api.js
// JSON API for the admin panel (used by the import page JS).
const express = require('express');
const router = express.Router();

const { importFromUrl } = require('../lib/scraper');
const { requireAdmin } = require('../middleware/auth');

router.post('/import', requireAdmin, async (req, res) => {
  try {
    const { url } = req.body;
    const data = await importFromUrl(url);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Quick product status toggle
router.post('/product/:id/toggle', requireAdmin, (req, res) => {
  const { db } = require('../lib/db');
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'not_found' });
  const next = p.status === 'published' ? 'draft' : 'published';
  db.prepare('UPDATE products SET status = ?, updated_at = ? WHERE id = ?')
    .run(next, new Date().toISOString(), p.id);
  res.json({ ok: true, status: next });
});

// Helper: suggest selling price from original + markup %
router.post('/price-suggest', requireAdmin, (req, res) => {
  const original = parseFloat(req.body.original) || 0;
  const margin = parseFloat(req.body.margin) || 0; // percent
  const round = parseInt(req.body.round || '0', 10);
  let price = original * (1 + margin / 100);
  if (round > 0) {
    price = Math.ceil(price / round) * round;
  }
  res.json({ ok: true, price: Math.round(price * 100) / 100 });
});

module.exports = router;
