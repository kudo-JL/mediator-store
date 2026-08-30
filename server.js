// server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const { db, getAllSettings } = require('./lib/db');
const { run: seed } = require('./lib/seed');
const i18n = require('./lib/i18n');
const { loadAdmin, requireAdmin } = require('./middleware/auth');

const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

const app = express();

// ---- View engine ----
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ---- Core middleware ----
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-please',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
    },
  })
);

// ---- Static ----
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d' }));

// ---- Locals (i18n + settings) ----
app.use(i18n.middleware());
app.use((req, res, next) => {
  // expose site-wide settings and a few helpers
  const s = getAllSettings();
  res.locals.site = {
    name: s.store_name || 'متجر الوسيط',
    currency: s.store_currency || 'د.م.',
    contact: {
      phone: s.contact_phone || '',
      email: s.contact_email || '',
      whatsapp: s.contact_whatsapp || '',
      address: s.contact_address || '',
    },
    shipping_fee: parseFloat(s.shipping_fee || '0') || 0,
    free_shipping_threshold: parseFloat(s.free_shipping_threshold || '0') || 0,
    footer_note: s.footer_note || '',
  };
  res.locals.fmtPrice = (n) => {
    const num = Number(n || 0);
    const fixed = num.toFixed(2);
    // Always use Latin digits (0-9) — even on Arabic pages.
    // The currency symbol naturally handles locale semantics.
    const [intPart, decPart] = fixed.split('.');
    const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${withThousands}.${decPart} ${res.locals.site.currency}`;
  };
  res.locals.currentPath = req.path;
  res.locals.flash = req.session.flash || null;
  req.session.flash = null;
  next();
});

app.use(loadAdmin);

// ---- Routes ----
app.use('/admin', adminRoutes);     // admin pages
app.use('/api', apiRoutes);         // JSON API (admin actions)
app.use('/', publicRoutes);         // public storefront

// ---- Offline page (PWA) ----
app.get('/offline', (req, res) => {
  res.render('public/offline', { title: 'غير متصل' });
});

// ---- 404 ----
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).render('public/404', { title: '404' });
  }
  res.status(404).json({ error: 'not_found' });
});

// ---- Errors ----
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (req.accepts('html')) {
    return res
      .status(500)
      .render('public/error', { title: 'Error', message: err.message || 'Server error' });
  }
  res.status(500).json({ error: 'server_error', message: err.message });
});

// ---- Boot ----
seed();
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`[mediator-store] listening on http://localhost:${PORT}`);
  console.log(`[mediator-store] admin: /admin/login   default: ${process.env.ADMIN_USERNAME || 'admin'} / ${process.env.ADMIN_PASSWORD || 'admin123'}`);
});
