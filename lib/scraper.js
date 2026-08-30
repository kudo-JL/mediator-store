// lib/scraper.js
// Multi-strategy product URL importer.
// Tries, in order: JSON-LD (Schema.org Product) -> Open Graph -> heuristics.
// Also extracts a ranked list of candidate images and tries to download the
// best one with realistic browser headers.

const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'products');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- helpers ----------

function absUrl(base, maybe) {
  if (!maybe) return null;
  try {
    return new URL(maybe, base).toString();
  } catch {
    return null;
  }
}

function pickPrice(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    const cleaned = String(c).replace(/[^\d.,-]/g, '').replace(/\s+/g, '');
    if (!cleaned) continue;
    let normalized = cleaned;
    if (cleaned.includes(',') && cleaned.includes('.')) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (cleaned.includes(',') && !cleaned.includes('.')) {
      normalized = cleaned.replace(',', '.');
    }
    const n = parseFloat(normalized);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function detectStore(host) {
  const h = (host || '').toLowerCase();
  if (h.includes('amazon')) return 'Amazon';
  if (h.includes('aliexpress')) return 'AliExpress';
  if (h.includes('jumia')) return 'Jumia';
  if (h.includes('noon')) return 'Noon';
  if (h.includes('ebay')) return 'eBay';
  if (h.includes('shein')) return 'Shein';
  if (h.includes('alibaba')) return 'Alibaba';
  if (h.includes('walmart')) return 'Walmart';
  if (h.includes('mediamarkt')) return 'MediaMarkt';
  if (h.includes('fnac')) return 'Fnac';
  if (h.includes('cdiscount')) return 'Cdiscount';
  return host || '';
}

// ---------- product data extractors ----------

function extractFromJsonLd($, url) {
  const scripts = $('script[type="application/ld+json"]').toArray();
  for (const s of scripts.reverse()) {
    const raw = $(s).contents().text();
    if (!raw || !raw.trim()) continue;
    let data;
    try { data = JSON.parse(raw); } catch { continue; }
    const items = Array.isArray(data) ? data : [data];
    for (const it of items) {
      if (!it) continue;
      const nodes = it['@graph'] ? [it, ...(it['@graph'] || [])] : [it];
      for (const node of nodes) {
        const t = node['@type'];
        const isProduct =
          (typeof t === 'string' && t.toLowerCase() === 'product') ||
          (Array.isArray(t) && t.some((x) => String(x).toLowerCase() === 'product'));
        if (!isProduct) continue;
        const name = node.name || '';
        let image = null;
        if (Array.isArray(node.image)) {
          image = node.image.find((x) => typeof x === 'string' && x) || node.image[0];
        } else if (typeof node.image === 'string') {
          image = node.image;
        } else if (node.image && node.image.url) {
          image = node.image.url;
        }
        const description = node.description || '';
        let price = 0;
        if (node.offers) {
          const offers = Array.isArray(node.offers) ? node.offers : [node.offers];
          for (const off of offers) {
            if (!off) continue;
            if (off.price) { price = pickPrice(off.price); if (price) break; }
            if (off.lowPrice) { price = pickPrice(off.lowPrice); if (price) break; }
          }
        }
        const sku = node.sku || node.mpn || '';
        return {
          name: String(name).trim(),
          image: image ? absUrl(url, String(image)) : null,
          description: String(description).trim(),
          price,
          sku: String(sku).trim(),
        };
      }
    }
  }
  return null;
}

function extractFromMeta($, url) {
  const meta = (name) =>
    $(`meta[property="${name}"]`).attr('content') ||
    $(`meta[name="${name}"]`).attr('content') ||
    '';
  const title =
    meta('og:title') || meta('twitter:title') || $('title').first().text().trim();
  const image =
    meta('og:image') ||
    meta('og:image:url') ||
    meta('og:image:secure_url') ||
    meta('twitter:image') ||
    meta('twitter:image:src') ||
    $('link[rel="image_src"]').attr('href') ||
    $('img[itemprop="image"]').first().attr('src') ||
    $('img[itemprop="image"]').first().attr('content') ||
    '';
  const description =
    meta('og:description') ||
    meta('twitter:description') ||
    meta('description') ||
    '';
  const priceMeta =
    meta('product:price:amount') ||
    meta('og:price:amount') ||
    $('[itemprop="price"]').first().attr('content') ||
    $('[itemprop="price"]').first().text() ||
    '';
  return {
    name: title.trim(),
    image: absUrl(url, image),
    description: description.trim(),
    price: pickPrice(priceMeta),
  };
}

function extractByHeuristics($, url) {
  const name =
    $('h1.product-title, h1.product-name, h1[itemprop="name"], h1').first().text().trim() ||
    $('title').first().text().trim();
  const image =
    $('img.product-img, img#product-image, img[itemprop="image"], .gallery img, .product img')
      .first()
      .attr('src') ||
    $('img').first().attr('src') ||
    '';
  const description =
    $('[itemprop="description"], .product-description, .description, #description')
      .first()
      .text()
      .trim();
  let price = 0;
  $('[itemprop="price"], .price, .product-price, .current-price, .sale-price').each((_, el) => {
    if (price) return;
    const t = $(el).text();
    const c = $(el).attr('content');
    price = pickPrice(t, c);
  });
  if (!price) {
    $('*').each((_, el) => {
      if (price) return;
      const txt = $(el).contents().first().text();
      if (txt && /\d/.test(txt) && (txt.includes('$') || /\bMAD\b|\bد\.م\./i.test(txt))) {
        price = pickPrice(txt);
      }
    });
  }
  return {
    name,
    image: absUrl(url, image),
    description,
    price,
  };
}

// ---------- image ranking ----------

/**
 * Build a ranked list of candidate product image URLs from the page.
 * Higher score = more likely to be the main product image.
 */
function collectImageCandidates($, baseUrl, schemaImageUrl) {
  const candidates = [];
  const seen = new Set();
  const push = (url, score, src) => {
    if (!url) return;
    if (seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, score, src });
  };

  // 1) Schema.org product image (very reliable when present)
  if (schemaImageUrl) push(schemaImageUrl, 200, 'json-ld');

  // 2) Open Graph
  const og =
    $('meta[property="og:image:secure_url"]').attr('content') ||
    $('meta[property="og:image:url"]').attr('content') ||
    $('meta[property="og:image"]').attr('content');
  if (og) push(absUrl(baseUrl, og), 180, 'og:image');

  // 3) Twitter card
  const tw =
    $('meta[name="twitter:image:src"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    $('meta[property="twitter:image"]').attr('content') ||
    $('meta[property="twitter:image:src"]').attr('content');
  if (tw) push(absUrl(baseUrl, tw), 170, 'twitter:image');

  // 4) <link rel="image_src">
  const linkImg = $('link[rel="image_src"]').attr('href');
  if (linkImg) push(absUrl(baseUrl, linkImg), 160, 'link:image_src');

  // 5) itemprop="image"
  $('[itemprop="image"]').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('content') || $(el).attr('href');
    if (src) push(absUrl(baseUrl, src), 150, 'itemprop:image');
  });

  // 6) Common product-image selectors
  const selectors = [
    '.product-image img', '#product-image', '#product img',
    '.product-img', '.product-photo', '.product__image', '.product__photo',
    '.gallery img', '.product-gallery img', '.main-image img',
    '.woocommerce-product-gallery__image img',
    '[data-role="product-image"] img', '.pdp-image img', '.pdp-hero img',
    '.product-media img', '#gallery img',
  ];
  for (const sel of selectors) {
    const el = $(sel).first();
    if (!el.length) continue;
    const src =
      el.attr('src') ||
      el.attr('data-src') ||
      el.attr('data-lazy-src') ||
      el.attr('data-original') ||
      el.attr('data-hi-res-src');
    if (src) push(absUrl(baseUrl, src), 130 - selectors.indexOf(sel), 'selector');
  }

  // 7) Fallback: any <img>, with strong filtering
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original');
    if (!src) return;
    const url = absUrl(baseUrl, src);
    if (!url) return;
    // Skip obviously non-product images
    if (/sprite|logo|icon|avatar|pixel|tracking|1x1|spacer|placeholder|loading|badge|button|nav|footer|header/i.test(url)) return;
    const alt = ($(el).attr('alt') || '').toLowerCase();
    if (alt && /(logo|icon|avatar)/i.test(alt)) return;
    let score = 40;
    if (/product|main|hero|large|big|full|detail|zoom|primary|cover/i.test(url)) score += 25;
    if (alt && alt.length > 4) score += 8;
    // data-src-style hints
    if ($(el).attr('data-src') || $(el).attr('data-lazy-src')) score += 5;
    push(url, score, 'img');
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// ---------- image download ----------

const SKIP_EXT = /\.(svg|ico|gif)(\?|$|#)/i;

function extFromUrl(imageUrl, contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  const m = imageUrl.toLowerCase().match(/\.(png|jpg|jpeg|webp|gif)(\?|$|#)/);
  if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
  return 'jpg';
}

async function tryDownload(imageUrl, referer) {
  try {
    const resp = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxContentLength: 15 * 1024 * 1024, // 15 MB cap
      headers: {
        'User-Agent': UA,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8,fr;q=0.8',
        Referer: referer,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      validateStatus: (s) => s >= 200 && s < 300,
      // Some CDNs need a redirect chain
      maxRedirects: 5,
    });
    const buf = Buffer.from(resp.data);
    if (buf.length < 512) return null; // skip tiny placeholders
    // SVG is allowed but treated carefully
    const ct = (resp.headers['content-type'] || '').toLowerCase();
    if (ct.includes('text/html')) return null; // not an image
    const ext = extFromUrl(imageUrl, ct);
    if (SKIP_EXT.test(imageUrl) && ext === 'jpg') return null;
    return { buf, ext };
  } catch {
    return null;
  }
}

async function downloadBestImage(candidates, sourcePageUrl) {
  // Try the best candidates in order. Some stores return placeholders or
  // CDN-blocked URLs — falling through to the next candidate often works.
  for (const c of candidates.slice(0, 8)) {
    const result = await tryDownload(c.url, sourcePageUrl);
    if (result) {
      const name = `${crypto.randomBytes(8).toString('hex')}.${result.ext}`;
      const filePath = path.join(UPLOAD_DIR, name);
      fs.writeFileSync(filePath, result.buf);
      return { imagePath: `/uploads/products/${name}`, usedUrl: c.url, src: c.src };
    }
  }
  return null;
}

// Allow callers (e.g. the import view's "use this URL" field) to download
// an image from an arbitrary URL, with the same saving + headers logic.
async function downloadImageByUrl(imageUrl, referer) {
  const result = await tryDownload(imageUrl, referer);
  if (!result) return null;
  const name = `${crypto.randomBytes(8).toString('hex')}.${result.ext}`;
  const filePath = path.join(UPLOAD_DIR, name);
  fs.writeFileSync(filePath, result.buf);
  return `/uploads/products/${name}`;
}

// ---------- main entry point ----------

/**
 * Import product from URL.
 * Returns: {
 *   name, description, image, imagePath, sourceImageUrl, price,
 *   sourceUrl, sourceStore, sku, imageCandidates (ranked)
 * }
 *
 * `image`         — best raw URL we found on the source page
 * `imagePath`     — local path after download, or null if download failed
 * `sourceImageUrl`— same as `image` (stored in DB for fallback display)
 */
async function importFromUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('URL is required and must start with http(s)://');
  }
  const resp = await axios.get(url, {
    timeout: 25000,
    maxContentLength: 8 * 1024 * 1024,
    headers: {
      'User-Agent': UA,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8,fr;q=0.8',
      'Cache-Control': 'no-cache',
    },
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const html = resp.data;
  const $ = cheerio.load(html);
  const host = (() => {
    try { return new URL(url).host; } catch { return ''; }
  })();

  const found =
    extractFromJsonLd($, url) ||
    extractFromMeta($, url) ||
    extractByHeuristics($, url);

  if (!found || !found.name) {
    throw new Error('Could not extract product data from this URL.');
  }

  // Build a ranked list of image candidates and try the top ones.
  const candidates = collectImageCandidates($, url, found.image);
  const downloaded = await downloadBestImage(candidates, url);

  return {
    name: found.name,
    description: found.description || '',
    // Keep the original URL for fallback display + storage.
    image: found.image || (candidates[0] ? candidates[0].url : null),
    sourceImageUrl: found.image || (candidates[0] ? candidates[0].url : null),
    // Local path if we managed to download.
    imagePath: downloaded ? downloaded.imagePath : null,
    imageDownloadedFrom: downloaded ? downloaded.usedUrl : null,
    imageSource: downloaded ? downloaded.src : null,
    imageCandidates: candidates.slice(0, 6).map((c) => ({ url: c.url, src: c.src })),
    price: found.price || 0,
    sku: found.sku || '',
    sourceUrl: url,
    sourceStore: detectStore(host),
  };
}

module.exports = {
  importFromUrl,
  downloadImage: downloadImageByUrl, // backward-compat with earlier API
  downloadImageByUrl,
  // exposed for tests
  collectImageCandidates,
  detectStore,
};
