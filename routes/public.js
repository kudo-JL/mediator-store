// routes/public.js
// Public storefront: home, product, cart, checkout, place order.
const express = require('express');
const path = require('path');
const axios = require('axios');
const router = express.Router();

const { db, generateOrderNumber, getSetting } = require('../lib/db');

// ---- Helpers ----
function getCart(req) {
  if (!req.session.cart) req.session.cart = { items: [] };
  return req.session.cart;
}

function saveCart(req, cart) {
  req.session.cart = cart;
}

function getProductName(p, lang) {
  if (lang === 'fr' && p.name_fr) return p.name_fr;
  if (lang === 'en' && p.name_en) return p.name_en;
  return p.name_ar || p.name_fr || p.name_en || '';
}

function getProductDesc(p, lang) {
  if (lang === 'fr' && p.description_fr) return p.description_fr;
  if (lang === 'en' && p.description_en) return p.description_en;
  return p.description_ar || p.description_fr || p.description_en || '';
}

function publicProduct(p, lang) {
  return {
    id: p.id,
    name: getProductName(p, lang),
    description: getProductDesc(p, lang),
    image_path: p.image_path,
    // Fallback: if no local image, use the source URL we kept in DB.
    source_image_url: p.source_image_url,
    selling_price: p.selling_price,
    sku: p.sku,
    slug: p.slug,
    category_id: p.category_id,
    stock: p.stock,
    featured: !!p.featured,
    // explicitly omit original_price, cost_price, source_url
  };
}

// ---- Home ----
router.get('/', (req, res) => {
  const lang = res.locals.lang;
  const featured = db
    .prepare(
      `SELECT * FROM products WHERE status = 'published' AND featured = 1 ORDER BY created_at DESC LIMIT 8`
    )
    .all();
  const latest = db
    .prepare(
      `SELECT * FROM products WHERE status = 'published' ORDER BY created_at DESC LIMIT 24`
    )
    .all();
  const cats = db.prepare('SELECT * FROM categories ORDER BY name_ar').all();
  res.render('public/index', {
    title: res.locals.site.name,
    featured: featured.map((p) => publicProduct(p, lang)),
    products: latest.map((p) => publicProduct(p, lang)),
    categories: cats,
  });
});

// ---- Category ----
router.get('/c/:slug', (req, res) => {
  const lang = res.locals.lang;
  const cat = db.prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.slug);
  if (!cat) return res.status(404).render('public/404', { title: '404' });
  const rows = db
    .prepare(
      `SELECT * FROM products WHERE status = 'published' AND category_id = ? ORDER BY created_at DESC`
    )
    .all(cat.id);
  res.render('public/category', {
    title: getProductName(cat, lang),
    category: cat,
    products: rows.map((p) => publicProduct(p, lang)),
  });
});

// ---- Product detail ----
router.get('/p/:id', (req, res) => {
  const lang = res.locals.lang;
  const p = db.prepare("SELECT * FROM products WHERE id = ? AND status = 'published'").get(req.params.id);
  if (!p) return res.status(404).render('public/404', { title: '404' });
  const related = db
    .prepare(
      `SELECT * FROM products WHERE status = 'published' AND id != ? AND category_id = ? ORDER BY created_at DESC LIMIT 4`
    )
    .all(p.id, p.category_id || 0)
    .map((x) => publicProduct(x, lang));
  res.render('public/product', {
    title: getProductName(p, lang),
    product: publicProduct(p, lang),
    related,
  });
});

// ---- Search ----
router.get('/search', (req, res) => {
  const lang = res.locals.lang;
  const q = (req.query.q || '').trim();
  let rows = [];
  if (q) {
    rows = db
      .prepare(
        `SELECT * FROM products WHERE status = 'published' AND (
          name_ar LIKE ? OR name_fr LIKE ? OR name_en LIKE ? OR description_ar LIKE ?
        ) ORDER BY created_at DESC LIMIT 60`
      )
      .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  res.render('public/search', {
    title: q ? `بحث: ${q}` : 'بحث',
    q,
    products: rows.map((p) => publicProduct(p, lang)),
  });
});

// ---- Cart helpers (JSON endpoints for the front-end) ----
router.post('/cart/add', (req, res) => {
  const id = parseInt(req.body.product_id, 10);
  const qty = Math.max(1, parseInt(req.body.quantity, 10) || 1);
  const p = db.prepare("SELECT * FROM products WHERE id = ? AND status = 'published'").get(id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const cart = getCart(req);
  const existing = cart.items.find((it) => it.product_id === id);
  if (existing) existing.quantity += qty;
  else
    cart.items.push({
      product_id: p.id,
      name: getProductName(p, res.locals.lang),
      image_path: p.image_path,
      unit_price: p.selling_price,
      quantity: qty,
    });
  saveCart(req, cart);
  res.json({ ok: true, count: cart.items.reduce((s, it) => s + it.quantity, 0) });
});

router.post('/cart/update', (req, res) => {
  const id = parseInt(req.body.product_id, 10);
  const qty = Math.max(0, parseInt(req.body.quantity, 10) || 0);
  const cart = getCart(req);
  const idx = cart.items.findIndex((it) => it.product_id === id);
  if (idx >= 0) {
    if (qty === 0) cart.items.splice(idx, 1);
    else cart.items[idx].quantity = qty;
  }
  saveCart(req, cart);
  res.json({ ok: true, count: cart.items.reduce((s, it) => s + it.quantity, 0) });
});

router.post('/cart/remove', (req, res) => {
  const id = parseInt(req.body.product_id, 10);
  const cart = getCart(req);
  cart.items = cart.items.filter((it) => it.product_id !== id);
  saveCart(req, cart);
  res.json({ ok: true, count: cart.items.reduce((s, it) => s + it.quantity, 0) });
});

router.get('/cart/count', (req, res) => {
  const cart = getCart(req);
  res.json({ count: cart.items.reduce((s, it) => s + it.quantity, 0) });
});

// ---- Cart page ----
router.get('/cart', (req, res) => {
  const cart = getCart(req);
  const subtotal = cart.items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
  res.render('public/cart', { title: 'سلة المشتريات', cart, subtotal });
});

// ---- Checkout ----
router.get('/checkout', (req, res) => {
  const cart = getCart(req);
  if (cart.items.length === 0) return res.redirect('/cart');
  const subtotal = cart.items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
  const ship =
    res.locals.site.free_shipping_threshold > 0 &&
    subtotal >= res.locals.site.free_shipping_threshold
      ? 0
      : res.locals.site.shipping_fee;
  const total = subtotal + ship;
  res.render('public/checkout', { title: 'إتمام الطلب', cart, subtotal, shipping: ship, total });
});

router.post('/checkout', (req, res) => {
  const cart = getCart(req);
  if (cart.items.length === 0) return res.redirect('/cart');
  const {
    customer_name = '',
    customer_phone = '',
    customer_email = '',
    customer_address = '',
    customer_city = '',
    customer_notes = '',
    payment_method = 'cod',
  } = req.body;
  if (!customer_name.trim() || !customer_phone.trim()) {
    req.session.flash = { type: 'error', message: 'الاسم والهاتف مطلوبان.' };
    return res.redirect('/checkout');
  }
  const subtotal = cart.items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
  const ship =
    res.locals.site.free_shipping_threshold > 0 &&
    subtotal >= res.locals.site.free_shipping_threshold
      ? 0
      : res.locals.site.shipping_fee;
  const total = subtotal + ship;
  const orderNumber = generateOrderNumber();

  // node:sqlite has no db.transaction(); do BEGIN/COMMIT manually.
  let orderId = null;
  try {
    db.exec('BEGIN');
    const info = db
      .prepare(
        `INSERT INTO orders (
          order_number, customer_name, customer_phone, customer_email,
          customer_address, customer_city, customer_notes,
          subtotal, shipping, total, status, payment_method
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(
        orderNumber,
        customer_name.trim(),
        customer_phone.trim(),
        customer_email.trim(),
        customer_address.trim(),
        customer_city.trim(),
        customer_notes.trim(),
        subtotal,
        ship,
        total,
        payment_method
      );
    orderId = info.lastInsertRowid;
    const itemStmt = db.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const it of cart.items) {
      itemStmt.run(orderId, it.product_id, it.name, it.unit_price, it.quantity, it.unit_price * it.quantity);
      // decrement stock
      db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?').run(it.quantity, it.product_id);
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
  saveCart(req, { items: [] });

  // Fire-and-forget admin notification (Telegram + WhatsApp).
  // We don't await so the customer gets redirected immediately.
  try {
    const { notifyNewOrder } = require('../lib/notifications');
    notifyNewOrder({
      order_number: orderNumber,
      customer_name: customer_name.trim(),
      customer_phone: customer_phone.trim(),
      customer_email: customer_email.trim(),
      customer_city: customer_city.trim(),
      customer_address: customer_address.trim(),
      customer_notes: customer_notes.trim(),
      payment_method,
      subtotal,
      shipping: ship,
      total,
      items: cart.items.map((it) => ({
        product_name: it.name,
        quantity: it.quantity,
      })),
    }).catch((e) => console.error('[notify]', e));
  } catch (e) {
    console.error('[notify-init]', e);
  }

  res.redirect(`/order/${orderNumber}`);
});

// ---- Order success page ----
router.get('/order/:order_number', (req, res) => {
  const order = db
    .prepare('SELECT * FROM orders WHERE order_number = ?')
    .get(req.params.order_number);
  if (!order) return res.status(404).render('public/404', { title: '404' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('public/order-success', { title: 'تم استلام طلبك', order, items });
});

// ---- Image proxy ----
// Streams an external image through the server so the browser can render
// it without dealing with CORS / hotlink protection on the source site.
const ALLOWED_HOST_HINTS = /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$|#)/i;
router.get('/img-proxy', async (req, res) => {
  const url = (req.query.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).send('bad url');
  try {
    const resp = await axios.get(url, {
      responseType: 'stream',
      timeout: 20000,
      maxContentLength: 15 * 1024 * 1024,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        Referer: (() => { try { return new URL(url).origin; } catch { return url; } })(),
      },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const ct = (resp.headers['content-type'] || '').toLowerCase();
    if (!ct.startsWith('image/')) return res.status(415).send('not an image');
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    resp.data.pipe(res);
  } catch (e) {
    res.status(502).send('upstream error');
  }
});

// ---- Set language cookie ----
router.get('/lang/:code', (req, res) => {
  const { SUPPORTED } = require('../lib/i18n');
  const code = SUPPORTED.includes(req.params.code) ? req.params.code : 'ar';
  res.cookie('lang', code, { maxAge: 1000 * 60 * 60 * 24 * 365, sameSite: 'lax' });
  res.redirect(req.query.next || '/');
});

module.exports = router;
