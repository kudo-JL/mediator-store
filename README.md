# mediator-store

Reseller / dropshipping e-commerce store in Arabic (RTL), with a one-click **import by URL** feature, hidden original prices (so you control your margin), and full admin panel.

## Features

### Public storefront
- Arabic-first, RTL layout, with i18n ready for French and English
- Hero + featured + latest products on the homepage
- Category pages, search, product detail with related products
- Cart (session-based, no login required), checkout with shipping
- Order success page with one-click **WhatsApp confirm** to the store

### Admin panel (`/admin`)
- Login (default: `admin` / `admin123` — change after first login)
- Dashboard with stats
- **Products**: add (manual or by URL), edit, delete, toggle publish/draft, mark featured
- **Import by URL** with **bulletproof image handling**:
  - Auto-extracts name, image, description, original price from JSON-LD / Open Graph / Twitter / `<img>` / common selectors
  - Ranks image candidates and tries the top 8 with realistic browser headers
  - If download still fails: keeps the source URL and serves the image through the built-in `/img-proxy` (server-side proxy that bypasses hotlink/CORS)
  - You can also **paste a custom image URL** or **upload from disk** on the import form
  - The full candidates list is shown as clickable thumbnails
- **Original price is hidden from customers** (kept in DB for margin tracking)
- **Profit calculator**: type a margin % and it auto-applies to the selling price
- **Categories** with multi-language names
- **Orders**: list, detail, status workflow (`pending → confirmed → shipped → delivered / cancelled`)
- **Settings**: store name, currency, shipping fee, free-shipping threshold, contact phone / WhatsApp / email / address
- **Change password**

> **Note on digits**: prices always use Latin digits (`0-9`), even on the Arabic RTL storefront. This avoids confusion in invoices and WhatsApp messages.

### Why this store is special
- **Original price** is stored in DB but never shown to the public. You only show your selling price.
- A built-in **margin calculator** suggests the selling price from the original + a percentage.
- One-click **WhatsApp** on order success and on the admin order detail (huge in MENA markets).
- Built on **node:sqlite** (no native deps, works on Node 24+), **multer 2.x**, **EJS**, **Express 4**.

## Quick start

```bash
# 1) Install
npm install

# 2) Configure
cp .env.example .env       # then edit values if you want
#    ADMIN_USERNAME / ADMIN_PASSWORD are used on first run to create the admin

# 3) Run
npm start                  # http://localhost:3000

# Or, with auto-reload (Node 22+):
npm run dev
```

Then open:
- Storefront: <http://localhost:3000>
- Admin:      <http://localhost:3000/admin/login>

Default admin: `admin` / `admin123` (change it in `/admin/settings`).

### Windows quick start

A `scripts/install-and-run.bat` is included. Just double-click it (or run from a terminal).

## Project layout

```
mediator-store/
├── server.js                # Express entry
├── package.json
├── .env.example
├── data/                    # SQLite database (auto-created)
├── uploads/products/        # User-uploaded product images
├── public/
│   ├── css/{store,admin}.css
│   ├── js/{store,cart,admin}.js
│   ├── images/favicon.svg
│   └── locales/{ar,fr,en}.json
├── views/
│   ├── layouts, partials/
│   ├── public/              # storefront pages
│   └── admin/               # admin pages
├── routes/
│   ├── public.js            # storefront routes
│   ├── admin.js             # admin routes (HTML)
│   └── api.js               # JSON API (used by import page)
├── lib/
│   ├── db.js                # node:sqlite setup
│   ├── i18n.js              # translation helper
│   ├── auth.js              # scrypt password hash
│   ├── scraper.js           # URL importer
│   └── seed.js              # first-run setup
└── middleware/auth.js
```

## How the URL importer works

1. Admin pastes a URL on `/admin/import`.
2. The server fetches the page (with a real User-Agent).
3. It tries, in order:
   - **Schema.org JSON-LD** (`Product` type) — works for most modern stores
   - **Open Graph / Twitter Card** meta tags
   - Heuristics on common selectors (`h1`, `.price`, etc.)
4. It downloads the product image to `public/uploads/products/`.
5. The admin sees a preview with the **original price** (from the source) and an editable **selling price** (default = original × 1.3, but you can change it). The profit calculator lets you type a margin % and auto-applies it.
6. The original price is **never** exposed on the public storefront.

> **Note on scraping**: Some sites block automated requests. If a URL fails, you can still add the product manually with `/admin/products/new`.

## i18n

`/lang/ar`, `/lang/fr`, `/lang/en` set a `lang` cookie. The default is Arabic (`ar`).
To translate, edit `public/locales/fr.json` (and `en.json`). They already contain all the keys — translate the values when you're ready.

## Switching to French as default

In `.env`:

```
DEFAULT_LANGUAGE=fr
```

Then restart.

## Data model (SQLite)

| Table       | Notes                                                                       |
|-------------|-----------------------------------------------------------------------------|
| `admins`    | id, username, password_hash (scrypt)                                        |
| `categories`| id, name_ar/fr/en, slug                                                      |
| `products`  | name_ar/fr/en, description_ar/fr/en, image_path, gallery_paths, **original_price** (hidden), **selling_price**, cost_price, source_url, source_store, status, featured, … |
| `orders`    | order_number, customer info, subtotal, shipping, total, status, payment_method |
| `order_items` | product_id, product_name (snapshot), unit_price, quantity, line_total   |
| `settings`  | key/value                                                                   |

## License

MIT — use it, modify it, sell through it.
