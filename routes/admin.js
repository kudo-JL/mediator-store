// routes/admin.js
// Admin pages: login, dashboard, products CRUD, import, orders, settings.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();

const { db, getAllSettings, setSetting } = require('../lib/db');
const { verifyPassword, hashPassword } = require('../lib/auth');
const { importFromUrl, downloadImageByUrl } = require('../lib/scraper');
const { requireAdmin } = require('../middleware/auth');

// ---- File upload (multer 2.x) ----
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'products');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (file.mimetype.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// ---- Login ----
router.get('/login', (req, res) => {
  if (res.locals.currentAdmin) return res.redirect('/admin');
  res.render('admin/login', { title: 'تسجيل الدخول', next: req.query.next || '' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!row || !verifyPassword(password || '', row.password_hash)) {
    req.session.flash = { type: 'error', message: 'بيانات الدخول غير صحيحة.' };
    return res.redirect('/admin/login');
  }
  req.session.adminId = row.id;
  const next = (req.body.next || '/admin').replace(/^([^/])/, '/$1');
  res.redirect(next);
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ---- Dashboard ----
router.get('/', requireAdmin, (req, res) => {
  const counts = {
    products: db.prepare(`SELECT COUNT(*) as c FROM products WHERE status='published'`).get().c,
    drafts: db.prepare(`SELECT COUNT(*) as c FROM products WHERE status='draft'`).get().c,
    orders: db.prepare('SELECT COUNT(*) as c FROM orders').get().c,
    pending: db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status='pending'`).get().c,
  };
  const recentOrders = db
    .prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8')
    .all();
  const recentProducts = db
    .prepare('SELECT * FROM products ORDER BY created_at DESC LIMIT 8')
    .all();
  res.render('admin/dashboard', {
    title: 'لوحة التحكم',
    counts,
    recentOrders,
    recentProducts,
  });
});

// ---- Products list ----
router.get('/products', requireAdmin, (req, res) => {
  const status = req.query.status || '';
  const q = (req.query.q || '').trim();
  const where = [];
  const args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (q) {
    where.push('(name_ar LIKE ? OR name_fr LIKE ? OR name_en LIKE ? OR sku LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const sql = `SELECT * FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
  const products = db.prepare(sql).all(...args);
  res.render('admin/products', { title: 'المنتجات', products, status, q });
});

// ---- Add / Edit form ----
router.get('/products/new', requireAdmin, (req, res) => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY name_ar').all();
  res.render('admin/product-form', {
    title: 'منتج جديد',
    product: null,
    categories: cats,
  });
});

router.get('/products/:id/edit', requireAdmin, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).render('public/404', { title: '404' });
  const cats = db.prepare('SELECT * FROM categories ORDER BY name_ar').all();
  res.render('admin/product-form', { title: 'تعديل منتج', product, categories: cats });
});

// ---- Save product (create or update) ----
router.post(
  '/products/save',
  requireAdmin,
  upload.array('gallery', 8),
  async (req, res) => {
    const id = parseInt(req.body.id, 10) || null;
    const name_ar = (req.body.name_ar || '').trim();
    if (!name_ar) {
      req.session.flash = { type: 'error', message: 'اسم المنتج بالعربية مطلوب.' };
      return res.redirect(id ? `/admin/products/${id}/edit` : '/admin/products/new');
    }
    const fields = {
      name_ar,
      name_fr: (req.body.name_fr || '').trim(),
      name_en: (req.body.name_en || '').trim(),
      description_ar: (req.body.description_ar || '').trim(),
      description_fr: (req.body.description_fr || '').trim(),
      description_en: (req.body.description_en || '').trim(),
      category_id: parseInt(req.body.category_id, 10) || null,
      original_price: parseFloat(req.body.original_price) || 0,
      selling_price: parseFloat(req.body.selling_price) || 0,
      cost_price: parseFloat(req.body.cost_price) || 0,
      sku: (req.body.sku || '').trim(),
      stock: parseInt(req.body.stock, 10) || 0,
      status: req.body.status === 'published' ? 'published' : 'draft',
      featured: req.body.featured === 'on' ? 1 : 0,
      source_url: (req.body.source_url || '').trim(),
      source_store: (req.body.source_store || '').trim(),
      updated_at: new Date().toISOString(),
    };
    const files = (req.files || []);
    const gallery = files.length
      ? JSON.stringify(files.map((f) => `/uploads/products/${f.filename}`))
      : null;

    // When a product is created via the URL importer, the scraped image
    // is already on disk. The form sends its public path as image_path_override
    // so the save route can re-use it without re-uploading.
    const imagePathOverride = (req.body.image_path_override || '').trim() || null;
    const sourceImageUrl = (req.body.source_image_url || '').trim() || null;
    const customImageUrl = (req.body.custom_image_url || '').trim() || null;

    // If the user pasted a custom image URL on the import form, try to
    // download it now (server-side, so hotlink/CORS aren't an issue).
    let customDownloadedPath = null;
    if (!id && customImageUrl && /^https?:\/\//i.test(customImageUrl)) {
      const referer = (req.body.source_url || '').trim() || customImageUrl;
      customDownloadedPath = await downloadImageByUrl(customImageUrl, referer);
    }
    try {
      if (id) {
        const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
        if (!existing) {
          req.session.flash = { type: 'error', message: 'المنتج غير موجود.' };
          return res.redirect('/admin/products');
        }
        // main image
        let imagePath = existing.image_path;
        if (files.length) imagePath = `/uploads/products/${files[0].filename}`;
        // append gallery (combine old + new)
        let galleryPaths = existing.gallery_paths;
        if (gallery) {
          const old = existing.gallery_paths ? JSON.parse(existing.gallery_paths) : [];
          const fresh = JSON.parse(gallery);
          galleryPaths = JSON.stringify([...old, ...fresh]);
        }
        db.prepare(
          `UPDATE products SET
            name_ar=@name_ar, name_fr=@name_fr, name_en=@name_en,
            description_ar=@description_ar, description_fr=@description_fr, description_en=@description_en,
            category_id=@category_id, original_price=@original_price, selling_price=@selling_price,
            cost_price=@cost_price, sku=@sku, stock=@stock, status=@status, featured=@featured,
            source_url=@source_url, source_store=@source_store, updated_at=@updated_at,
            image_path=@image_path, source_image_url=@source_image_url, gallery_paths=@gallery_paths
            WHERE id=@id`
        ).run({
          ...fields,
          image_path: imagePath,
          source_image_url: sourceImageUrl,
          gallery_paths: galleryPaths,
          id,
        });
      } else {
        const imagePath = files.length
          ? `/uploads/products/${files[0].filename}`
          : customDownloadedPath || imagePathOverride;
        // Strip updated_at — INSERT uses schema default CURRENT_TIMESTAMP.
        const { updated_at: _u, ...insertFields } = fields;
        const info = db
          .prepare(
            `INSERT INTO products (
              name_ar, name_fr, name_en,
              description_ar, description_fr, description_en,
              category_id, original_price, selling_price, cost_price,
              sku, stock, status, featured,
              source_url, source_store, image_path, source_image_url, gallery_paths
            ) VALUES (
              @name_ar, @name_fr, @name_en,
              @description_ar, @description_fr, @description_en,
              @category_id, @original_price, @selling_price, @cost_price,
              @sku, @stock, @status, @featured,
              @source_url, @source_store, @image_path, @source_image_url, @gallery_paths
            )`
          )
          .run({
            ...insertFields,
            image_path: imagePath,
            source_image_url: sourceImageUrl,
            gallery_paths: gallery,
          });
        return res.redirect(`/admin/products/${info.lastInsertRowid}/edit`);
      }
      req.session.flash = { type: 'success', message: 'تم حفظ المنتج.' };
      res.redirect('/admin/products');
    } catch (e) {
      console.error(e);
      req.session.flash = { type: 'error', message: 'تعذر الحفظ: ' + e.message };
      res.redirect(id ? `/admin/products/${id}/edit` : '/admin/products/new');
    }
  }
);

// ---- Delete product ----
router.post('/products/:id/delete', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.redirect('/admin/products');
  db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
  // best-effort: remove image files
  const tryRemove = (rel) => {
    if (!rel) return;
    const f = path.join(__dirname, '..', 'public', rel);
    fs.unlink(f, () => {});
  };
  tryRemove(p.image_path);
  if (p.gallery_paths) {
    try {
      JSON.parse(p.gallery_paths).forEach(tryRemove);
    } catch {}
  }
  req.session.flash = { type: 'success', message: 'تم حذف المنتج.' };
  res.redirect('/admin/products');
});

// ---- Toggle publish/draft ----
router.post('/products/:id/toggle', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.redirect('/admin/products');
  const next = p.status === 'published' ? 'draft' : 'published';
  db.prepare('UPDATE products SET status = ?, updated_at = ? WHERE id = ?').run(
    next,
    new Date().toISOString(),
    p.id
  );
  res.redirect('/admin/products');
});

// ---- Import by URL ----
router.get('/import', requireAdmin, (req, res) => {
  res.render('admin/import', { title: 'استيراد منتج برابط', result: null, error: null, url: '' });
});

router.post('/import', requireAdmin, async (req, res) => {
  const url = (req.body.url || '').trim();
  try {
    const data = await importFromUrl(url);
    res.render('admin/import', {
      title: 'استيراد منتج برابط',
      result: data,
      error: null,
      url,
    });
  } catch (e) {
    res.render('admin/import', {
      title: 'استيراد منتج برابط',
      result: null,
      error: e.message,
      url,
    });
  }
});

// ---- Orders ----
router.get('/orders', requireAdmin, (req, res) => {
  const status = req.query.status || '';
  const where = [];
  const args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  const sql = `SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
  const orders = db.prepare(sql).all(...args);
  res.render('admin/orders', { title: 'الطلبات', orders, status });
});

router.get('/orders/:id', requireAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).render('public/404', { title: '404' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('admin/order-detail', { title: `طلب #${order.order_number}`, order, items });
});

router.post('/orders/:id/status', requireAdmin, (req, res) => {
  const allowed = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  const status = allowed.includes(req.body.status) ? req.body.status : 'pending';
  db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    new Date().toISOString(),
    req.params.id
  );
  res.redirect(`/admin/orders/${req.params.id}`);
});

// ---- Categories ----
router.get('/categories', requireAdmin, (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name_ar').all();
  res.render('admin/categories', { title: 'الأقسام', categories });
});

router.post('/categories/save', requireAdmin, (req, res) => {
  const id = parseInt(req.body.id, 10) || null;
  const name_ar = (req.body.name_ar || '').trim();
  const slug = (req.body.slug || name_ar).toString().trim()
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 60);
  if (!name_ar || !slug) {
    req.session.flash = { type: 'error', message: 'الاسم و slug مطلوبان.' };
    return res.redirect('/admin/categories');
  }
  if (id) {
    db.prepare('UPDATE categories SET name_ar=?, name_fr=?, name_en=?, slug=? WHERE id=?')
      .run(name_ar, req.body.name_fr || '', req.body.name_en || '', slug, id);
  } else {
    try {
      db.prepare('INSERT INTO categories (name_ar, name_fr, name_en, slug) VALUES (?, ?, ?, ?)')
        .run(name_ar, req.body.name_fr || '', req.body.name_en || '', slug);
    } catch (e) {
      req.session.flash = { type: 'error', message: 'الـ slug مستعمل.' };
      return res.redirect('/admin/categories');
    }
  }
  res.redirect('/admin/categories');
});

router.post('/categories/:id/delete', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.redirect('/admin/categories');
});

// ---- Settings ----
router.get('/settings', requireAdmin, (req, res) => {
  res.render('admin/settings', { title: 'الإعدادات', settings: getAllSettings() });
});

router.post('/settings', requireAdmin, (req, res) => {
  const fields = [
    'store_name', 'store_currency', 'contact_phone', 'contact_email',
    'contact_whatsapp', 'contact_address', 'shipping_fee',
    'free_shipping_threshold', 'footer_note',
    // Notification settings
    'telegram_bot_token', 'telegram_chat_id',
    'callmebot_phone', 'callmebot_api_key',
  ];
  for (const f of fields) {
    if (req.body[f] != null) setSetting(f, String(req.body[f]).trim());
  }
  req.session.flash = { type: 'success', message: 'تم حفظ الإعدادات.' };
  res.redirect('/admin/settings');
});

// ---- Test notification (Telegram / WhatsApp) ----
router.post('/notifications/test', requireAdmin, async (req, res) => {
  const channel = (req.body && req.body.channel) || '';
  if (!['telegram', 'whatsapp'].includes(channel)) {
    return res.status(400).json({ ok: false, error: 'unknown_channel' });
  }
  try {
    const { sendTest } = require('../lib/notifications');
    const r = await sendTest(channel);
    if (r.ok) return res.json({ ok: true, message: 'تم الإرسال — افتح تيليجرام / واتساب' });
    if (r.reason === 'not_configured') {
      return res.status(400).json({ ok: false, error: 'لم يتم تكوين الإعدادات بعد' });
    }
    return res.status(500).json({ ok: false, error: r.error || 'فشل الإرسال' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- Change password ----
router.post('/account/password', requireAdmin, (req, res) => {
  const { current, next: nxt } = req.body;
  const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.session.adminId);
  if (!verifyPassword(current || '', row.password_hash)) {
    req.session.flash = { type: 'error', message: 'كلمة المرور الحالية غير صحيحة.' };
    return res.redirect('/admin/settings');
  }
  if (!nxt || nxt.length < 6) {
    req.session.flash = { type: 'error', message: 'كلمة المرور الجديدة قصيرة جداً (6 أحرف على الأقل).' };
    return res.redirect('/admin/settings');
  }
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?')
    .run(hashPassword(nxt), row.id);
  req.session.flash = { type: 'success', message: 'تم تغيير كلمة المرور.' };
  res.redirect('/admin/settings');
});

module.exports = router;
