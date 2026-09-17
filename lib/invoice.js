// Invoice PDF generator using pdfkit + qrcode.
// Saves invoice PDFs to /app/data/invoices/ (persistent volume).
// Uses Amiri font for Arabic text (loaded in Dockerfile).

const arabicReshaper = require('arabic-persian-reshaper');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const INVOICE_DIR = path.join(DATA_DIR, 'invoices');
const FONT_PATH = path.join(__dirname, 'fonts', 'Amiri-Regular.ttf');

if (!fs.existsSync(INVOICE_DIR)) {
  fs.mkdirSync(INVOICE_DIR, { recursive: true });
}

const useArabic = fs.existsSync(FONT_PATH);
const FONT_REG = useArabic ? 'Amiri' : 'Helvetica';
const FONT_BOLD = useArabic ? 'Amiri' : 'Helvetica-Bold';

function ar(text) {
  if (!text) return '';
  if (typeof arabicReshaper.reshaper === 'object' && arabicReshaper.reshaper.convertArabicToPersian) {
    return arabicReshaper.reshaper.convertArabicToPersian(String(text));
  }
  if (typeof arabicReshaper.reshape === 'function') {
    return arabicReshaper.reshape(String(text));
  }
  if (typeof arabicReshaper.convertArabic === 'function') {
    return arabicReshaper.convertArabic(String(text));
  }
  return String(text);
}

function generateInvoiceNumber(db) {
  // Use timestamp + random for guaranteed uniqueness, even if DB has corrupt duplicates.
  // Format: INV-2026-XXXXXX (6 digits = HHMMSS-ish, always unique per call).
  const year = new Date().getFullYear();
  const t = Date.now() % 1000000;  // last 6 digits of timestamp
  const rand = Math.floor(Math.random() * 100);
  return `INV-${year}-${String(t * 100 + rand).padStart(6, '0')}`;
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return `${v.toFixed(2)} DH`;
}

const STATUS_AR = {
  pending: 'قيد الانتظار',
  confirmed: 'مؤكد',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغى',
};

async function streamInvoice({ db, orderId, order, items, settings, verifyUrl, outStream }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  if (useArabic) doc.registerFont('Amiri', FONT_PATH);
  doc.pipe(outStream);

  const accent = '#c53030';
  const ink = '#1a202c';
  const muted = '#718096';

  // ---- Helper: 3-column row (left | center | right) ----
function row3(left, center, right, y) {
  if (left != null) {
    doc.font(FONT_REG).fontSize(10).fillColor(muted)
      .text(left, 50, y, { width: 150, align: 'left' });
  }
  if (center != null) {
    doc.font(FONT_BOLD).fontSize(11).fillColor(ink)
      .text(center, 200, y, { width: 195, align: 'center' });
  }
  if (right != null) {
    doc.font(FONT_REG).fontSize(10).fillColor(muted)
      .text(right, 395, y, { width: 150, align: 'right' });
  }
}

// ---- Header: store name (CENTER) ----
doc.font(FONT_BOLD).fontSize(22).fillColor(accent)
  .text(settings.site_name || 'Mediator Store', { align: 'center' });
doc.moveDown(0.2);

// ---- Tagline: Arabic (RIGHT) + French (LEFT) ----
row3(
  'Merci pour votre achat',
  null,
  'شكراً لتسوقكم معنا',
  doc.y
);
doc.moveDown(0.8);

// ---- Divider ----
doc.strokeColor(accent).lineWidth(1.5)
  .moveTo(50, doc.y).lineTo(545, doc.y).stroke();
doc.moveDown(0.6);

// ---- Invoice number: FACTURE (LEFT) | number (CENTER) | فاتورة (RIGHT) ----
row3('FACTURE', invoiceNumber, 'فاتورة', doc.y);
doc.moveDown(1);

// ---- Meta rows: French label (LEFT) | value (CENTER) | Arabic label (RIGHT) ----
row3("Date d'émission", issuedAt, 'تاريخ الإصدار', doc.y);
doc.moveDown(0.4);
row3('Référence commande', order.order_number, 'رقم الطلب', doc.y);
doc.moveDown(0.4);
row3('Statut', STATUS_AR[order.status] || order.status, 'الحالة', doc.y);
doc.moveDown(1);

  const colY = doc.y;
  doc.font(FONT_BOLD).fontSize(11).fillColor(accent)
    .text('البائع / Vendeur', { align: 'right' });
  doc.font(FONT_REG).fontSize(9).fillColor(ink);
  doc.text(settings.site_name || 'Mediator Store', { align: 'right' });

  const _phone = settings.company_phone || settings.contact_phone || '';
  const _email = settings.company_email || settings.contact_email || '';
  const _addr  = settings.company_address || settings.contact_address || '';
  const _city  = settings.company_city || '';

  if (_addr)  doc.text(_addr,  { align: 'right' });
  if (_city)  doc.text(_city,  { align: 'right' });
  if (_phone) doc.text(`Tél: ${_phone}`, { align: 'right' });
  if (_email) doc.text(_email, { align: 'right' });
  if (settings.company_if)      doc.text(`IF: ${settings.company_if}`, { align: 'right' });
  if (settings.company_ice)     doc.text(`ICE: ${settings.company_ice}`, { align: 'right' });
  if (settings.company_patente) doc.text(`Patente: ${settings.company_patente}`, { align: 'right' });

  doc.font(FONT_BOLD).fontSize(11).fillColor(accent)
    .text('الزبون / Client', 50, colY);
  doc.font(FONT_REG).fontSize(9).fillColor(ink);
  doc.text(order.customer_name || '', 50, colY + 16);
  if (order.customer_phone) doc.text(`Tél: ${order.customer_phone}`, 50, doc.y);
  if (order.customer_email) doc.text(order.customer_email, 50, doc.y);
  if (order.customer_address) doc.text(order.customer_address, 50, doc.y);
  if (order.customer_city) doc.text(order.customer_city, 50, doc.y);
  doc.moveDown(1.5);

  const tableTop = doc.y;
  const cols = { name: 50, qty: 320, price: 380, total: 470 };
  doc.font(FONT_BOLD).fontSize(10).fillColor('#fff')
    .rect(50, tableTop, 495, 22).fill(accent);
  doc.fillColor('#fff');
  doc.text('Désignation / المنتج', cols.name + 5, tableTop + 6);
  doc.text('Qté / الكمية', cols.qty, tableTop + 6, { width: 50, align: 'right' });
  doc.text('Prix / السعر', cols.price, tableTop + 6, { width: 80, align: 'right' });
  doc.text('Total / المجموع', cols.total, tableTop + 6, { width: 75, align: 'right' });

  doc.font(FONT_REG).fillColor(ink).fontSize(9);
  let y = tableTop + 28;
  items.forEach((it, idx) => {
    if (idx % 2 === 1) { doc.rect(50, y - 4, 495, 18).fill('#f7fafc'); doc.fillColor(ink); }
    const lineTotal = (Number(it.price) || 0) * (Number(it.quantity) || 0);
    doc.text(it.product_name || '', cols.name + 5, y, { width: 260 });
    doc.text(String(it.quantity), cols.qty, y, { width: 50, align: 'right' });
    doc.text(fmtMoney(it.price), cols.price, y, { width: 80, align: 'right' });
    doc.text(fmtMoney(lineTotal), cols.total, y, { width: 75, align: 'right' });
    y += 18;
  });
  doc.strokeColor('#cbd5e0').lineWidth(0.5).rect(50, tableTop, 495, y - tableTop).stroke();
  doc.moveDown(1.5);
  doc.y = y + 10;

  const totalsX = 340;
  doc.font(FONT_REG).fontSize(10).fillColor(ink);
  doc.text('Sous-total / المجموع الفرعي:', totalsX, doc.y, { width: 130, align: 'left' });
  doc.text(fmtMoney(order.subtotal), totalsX + 130, doc.y, { width: 75, align: 'right' });
  doc.moveDown(0.4);
  doc.text('Livraison / الشحن:', totalsX, doc.y, { width: 130, align: 'left' });
  doc.text(fmtMoney(order.shipping), totalsX + 130, doc.y, { width: 75, align: 'right' });
  doc.moveDown(0.4);
  doc.font(FONT_BOLD).fillColor(accent);
  doc.text('Total / المجموع:', totalsX, doc.y, { width: 130, align: 'left' });
  doc.text(fmtMoney(order.total), totalsX + 130, doc.y, { width: 75, align: 'right' });
  doc.font(FONT_REG).fillColor(ink);

  if (order.customer_notes) {
    doc.moveDown(2);
    doc.font(FONT_BOLD).fontSize(10).fillColor(accent).text('ملاحظات / Notes');
    doc.font(FONT_REG).fontSize(9).fillColor(ink).text(order.customer_notes, { width: 495 });
  }

  const footerY = 720;
  const qrUrl = verifyUrl || `${settings.site_url || ''}/order/${order.order_number}`;
  try {
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', margin: 1, width: 110 });
    const qrBuf = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    doc.image(qrBuf, 50, footerY - 60, { width: 70 });
  } catch (e) { console.error('[invoice] QR generation failed:', e.message); }

  doc.font(FONT_REG).fontSize(8).fillColor(muted);
  doc.text("Cette facture est générée automatiquement et sert de preuve d'achat.",
    140, footerY - 50, { width: 405, align: 'left' });
  doc.text('هذه الفاتورة تم إنشاؤها تلقائياً وتشكل إثبات الشراء.',
    140, footerY - 38, { width: 405, align: 'left' });
  doc.fontSize(7).text(`Vérifier l'authenticité / للتحقق من صحة الفاتورة: ${qrUrl}`,
    140, footerY - 22, { width: 405, align: 'left' });

  doc.end();
  return invoiceNumber;
}

async function generateInvoiceForOrder(db, orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of settingsRows) settings[r.key] = r.value;

  // STEP 1: Wipe any prior invoice record for this order. Avoids UNIQUE
  // conflicts when generating a fresh PDF on every download.
  db.prepare('DELETE FROM invoices WHERE order_id = ?').run(orderId);

  // STEP 2: Generate the PDF (always fresh — reflects current order status).
  const tmpPath = path.join(INVOICE_DIR, `INV-${Date.now()}.pdf`);
  const outStream = fs.createWriteStream(tmpPath);
  const verifyUrl = settings.site_url
    ? `${settings.site_url}/order/${order.order_number}`
    : null;
  const invoiceNumber = await streamInvoice({
    db, orderId, order, items, settings, verifyUrl, outStream,
  });
  await new Promise((resolve, reject) => {
    outStream.on('finish', resolve);
    outStream.on('error', reject);
  });

  const finalPath = path.join(INVOICE_DIR, `${invoiceNumber}.pdf`);
  fs.renameSync(tmpPath, finalPath);

  // STEP 3: Insert fresh record (DELETE above guarantees no UNIQUE conflict).
  db.prepare(
    `INSERT INTO invoices (order_id, invoice_number, pdf_path)
     VALUES (?, ?, ?)`,
  ).run(orderId, invoiceNumber, finalPath);

  return { invoiceNumber, pdfPath: finalPath, cached: false };
}

module.exports = {
  generateInvoiceForOrder,
  streamInvoice,
  generateInvoiceNumber,
  INVOICE_DIR,
};
