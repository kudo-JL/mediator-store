// lib/i18n.js
// Lightweight i18n: load JSON dictionary, expose t() and current lang.
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'public', 'locales');
const SUPPORTED = ['ar', 'fr', 'en'];
const DEFAULT_LANG = process.env.DEFAULT_LANGUAGE || 'ar';

const cache = {};
function load(lang) {
  if (cache[lang]) return cache[lang];
  const p = path.join(LOCALES_DIR, `${lang}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    cache[lang] = data;
    return data;
  } catch (e) {
    if (lang === DEFAULT_LANG) {
      // Hard-fail only for the default language
      throw new Error(`Cannot load default locale "${lang}": ${e.message}`);
    }
    return {};
  }
}

function pickLang(req) {
  // 1) explicit query ?lang=
  if (req.query && req.query.lang && SUPPORTED.includes(req.query.lang)) {
    return req.query.lang;
  }
  // 2) cookie
  if (req.cookies && SUPPORTED.includes(req.cookies.lang)) {
    return req.cookies.lang;
  }
  // 3) Accept-Language header
  if (req.headers && req.headers['accept-language']) {
    const al = req.headers['accept-language'].toLowerCase();
    for (const code of SUPPORTED) {
      if (al.includes(code)) return code;
    }
  }
  return DEFAULT_LANG;
}

function t(lang, key, vars) {
  const dict = load(lang);
  let val = dict[key];
  if (val == null) val = load(DEFAULT_LANG)[key] || key;
  if (vars && typeof val === 'string') {
    for (const [k, v] of Object.entries(vars)) {
      val = val.replace(new RegExp(`{${k}}`, 'g'), v);
    }
  }
  return val;
}

function middleware() {
  return (req, res, next) => {
    const lang = pickLang(req);
    res.locals.lang = lang;
    res.locals.dir = (lang === 'ar' || lang === 'he') ? 'rtl' : 'ltr';
    res.locals.t = (key, vars) => t(lang, key, vars);
    res.locals.supportedLangs = SUPPORTED;
    res.locals.LangName = { ar: 'العربية', fr: 'Français', en: 'English' };
    next();
  };
}

module.exports = { middleware, t, pickLang, SUPPORTED, DEFAULT_LANG };
