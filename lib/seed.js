// lib/seed.js
// Run automatically on first boot (or via `npm run seed`).
const { db, getAllSettings, setSetting } = require('./db');
const { hashPassword } = require('./auth');

function ensureSettings() {
  const defaults = {
    store_name: process.env.STORE_NAME || 'متجر الوسيط',
    store_currency: process.env.STORE_CURRENCY || 'د.م.',
    default_language: process.env.DEFAULT_LANGUAGE || 'ar',
    contact_phone: '',
    contact_email: '',
    contact_whatsapp: '',
    contact_address: '',
    shipping_fee: '0',
    free_shipping_threshold: '0',
    footer_note: '',
  };
  for (const [k, v] of Object.entries(defaults)) {
    const cur = getAllSettings();
    if (cur[k] == null || cur[k] === '') setSetting(k, v);
  }
}

function ensureAdmin() {
  const row = db.prepare('SELECT COUNT(*) as c FROM admins').get();
  if (row.c > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(
    username,
    hashPassword(password)
  );
  console.log(`[seed] Created default admin "${username}" (change the password after first login).`);
}

function ensureSampleCategory() {
  const c = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (c.c > 0) return;
  const stmt = db.prepare('INSERT INTO categories (name_ar, name_fr, name_en, slug) VALUES (?, ?, ?, ?)');
  stmt.run('عام', 'Général', 'General', 'general');
}

function run() {
  ensureSettings();
  ensureAdmin();
  ensureSampleCategory();
  console.log('[seed] OK');
}

if (require.main === module) {
  run();
  process.exit(0);
}

module.exports = { run };
