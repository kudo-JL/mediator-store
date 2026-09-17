// Invoice PDF generator using pdfkit + qrcode + arabic-reshaper.
// Saves invoice PDFs to /app/data/invoices/ (persistent volume).
// Invoice date is FROZEN to order.created_at so re-downloads don't change it.
// Uses Amiri font for Arabic text shaping.

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
// Removed arabic reshaper — Amiri font handles Arabic itself

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const INVOICE_DIR = path.join(DATA_DIR, 'invoices');
const FONT_PATH = path.join(__dirname, 'fonts', 'Amiri-Regular.ttf');

if (!fs.existsSync(INVOICE_DIR)) {
  fs.mkdirSync(INVOICE_DIR, { recursive: true });
}

/**
 * Reshape Arabic text so it renders correctly with PDFKit's basic fonts.
 */
function ar(text) {
  if (!text) return '';
  return String(text);
}

function generateInvoiceNumber(db) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const row = db
    .prepare(
      `SELECT invoice_number FROM invoices
       WHERE invoice_number LIKE ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(`${prefix}%`);
  let next = 1;
  if (row && row.invoice_number) {
    const tail = parseInt(row.invoice_number.split('-')[2], 10);
    if (!Number.isNaN(tail)) next = tail + 1;
  }
  return `${prefix}${String(next).padStart(4, '0')}`;
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return `${v.toFixed(2)} DH`;
}

const STATUS_AR = {
  pending: ar('قيد الانتظار'),
  confirmed: ar('مؤكد'),
  shipped: ar('تم الشحن'),
  delivered: ar('تم التسليم'),
  cancelled: ar('ملغى'),
};

async function streamInvoice({ db, orderId, order, items, settings, verifyUrl, outStream }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  // Register Amiri (Arabic-capable). Fall back to Helvetica if missing.
  const useArabic = fs.existsSync(FONT_PATH);
  if (useArabic) doc.registerFont('Amiri', FONT_PATH);
  const FONT = useArabic ? 'Amiri' : 'Helvetica';
  const FONT_BOLD = useArabic ? 'Amiri' : 'Helvetica-Bold';

  doc.pipe(outStream);

  const accent = '#c53030';
  const ink = '#1a202c';
  const muted = '#718096';

  // ---- Header ----
  doc.fontSize(22).fillColor(accent).font(FONT_BOLD)
    .text(ar(settings.site_name || 'Mediator Store'), { align: 'right' });
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor(muted).font(FONT)
    .text(ar(settings.site_tagline || 'منصة الوساطة للبيع الإلكتروني - المغرب'), { align: 'right' });
  doc.moveDown(0.6);
  doc.strokeColor(accent).lineWidth(1.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.6);

  const invoiceNumber = generateInvoiceNumber(db);
  const orderDate = order.created_at ? new Date(order.created_at) : new Date();
  const issuedAt = orderDate.toLocaleString('fr-MA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  // ---- Invoice meta (Latin left) ----
  doc.fontSize(20).fillColor(ink).font('Helvetica-Bold')
    .text(`FACTURE / ${ar('فاتورة')} : ${invoiceNumber}`, { align: 'left' });
  doc.moveDown(0.4);
  doc.fontSize(10).fillColor(ink).font('Helvetica');
  doc.text(`Date d'émission / ${ar('تاريخ الإصدار')}: ${issuedAt}`);
  doc.text(`Référence commande / ${ar('رقم الطلب')}: ${order.order_number}`);
  doc.text(`Statut / ${ar('الحالة')}: ${STATUS_AR[order.status] || order.status}`);
  doc.moveDown(1);

  // ---- Two columns ----
  const colY = doc.y;
  doc.fontSize(11).fillColor(accent).font(FONT_BOLD)
    .text(ar('البائع / Vendeur'), { align: 'right' });
  doc.fontSize(9).fillColor(ink).font(FONT);
  doc.text(ar(settings.site_name || 'Mediator Store'), { align: 'right' });
  if (settings.company_address) doc.text(ar(settings.company_address), { align: 'right' });
  if (settings.company_city) doc.text(ar(settings.company_city), { align: 'right' });
  if (settings.company_phone) doc.text(`Tél: ${settings.company_phone}`, { align: 'right' });
  if (settings.company_email) doc.text(settings.company_email, { align: 'right' });
  if (settings.company_if) doc.text(`IF: ${settings.company_if}`, { align: 'right' });
  if (settings.company_ice) doc.text(`ICE: ${settings.company_ice}`, { align: 'right' });
  if (settings.company_patente) doc.text(`Patente: ${settings.company_patente}`, { align: 'right' });

  doc.fontSize(11).fillColor(accent).font(FONT_BOLD)
    .text(ar('الزبون / Client'), 50, colY);
  doc.fontSize(9).fillColor(ink).font(FONT);
  doc.text(ar(order.customer_name || ''), 50, colY + 16);
  if (order.customer_phone) doc.text(`Tél: ${order.customer_phone}`, 50, doc.y);
  if (order.customer_email) doc.text(order.customer_email, 50, doc.y);
  if (order.customer_address) doc.text(ar(order.customer_address), 50, doc.y);
  if (order.customer_city) doc.text(ar(order.customer_city), 50, doc.y);
  doc.moveDown(1.5);

  // ---- Items table ----
  const tableTop = doc.y;
  const cols = { name: 50, qty: 320, price: 380, total: 470 };

  doc.fontSize(10).fillColor('#fff').rect(50, tableTop, 495, 22).fill(accent);
  doc.fillColor('#fff').font('Helvetica-Bold');
  doc.text(`Désignation / ${ar('المنتج')}`, cols.name + 5, tableTop + 6);
  doc.text(`Qté / ${ar('الكمية')}`, cols.qty, tableTop + 6, { width: 50, align: 'right' });
  doc.text(`Prix / ${ar('السعر')}`, cols.price, tableTop + 6, { width: 80, align: 'right' });
  doc.text(`Total / ${ar('المجموع')}`, cols.total, tableTop + 6, { width: 75, align: 'right' });

  doc.font('Helvetica').fillColor(ink).fontSize(9);
  let y = tableTop + 28;
  items.forEach((it, idx) => {
    if (idx % 2 === 1) { doc.rect(50, y - 4, 495, 18).fill('#f7fafc'); doc.fillColor(ink); }
    const lineTotal = (Number(it.price) || 0) * (Number(it.quantity) || 0);
    doc.font(FONT).text(ar(it.product_name || ''), cols.name + 5, y, { width: 260 });
    doc.font('Helvetica').text(String(it.quantity), cols.qty, y, { width: 50, align: 'right' });
    doc.text(fmtMoney(it.price), cols.price, y, { width: 80, align: 'right' });
    doc.text(fmtMoney(lineTotal), cols.total, y, { width: 75, align: 'right' });
    y += 18;
  });
  doc.strokeColor('#cbd5e0').lineWidth(0.5).rect(50, tableTop, 495, y - tableTop).stroke();
  doc.moveDown(1.5);
  doc.y = y + 10;

  // ---- Totals ----
  const totalsX = 340;
  doc.fontSize(10).fillColor(ink).font('Helvetica');
  doc.text(`Sous-total / ${ar('المجموع الفرعي')}:`, totalsX, doc.y, { width: 130, align: 'left' });
  doc.text(fmtMoney(order.subtotal), totalsX + 130, doc.y, { width: 75, align: 'right' });
  doc.moveDown(0.4);
  doc.text(`Livraison / ${ar('الشحن')}:`, totalsX, doc.y, { width: 130, align: 'left' });
  doc.text(fmtMoney(order.shipping), totalsX + 130, doc.y, { width: 75, align: 'right' });
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fillColor(accent);
  doc.text(`Total / ${ar('المجموع')}:`, totalsX, doc.y, { width: 130, align: 'left' });
  doc.text(fmtMoney(order.total), totalsX + 130, doc.y, { width: 75, align: 'right' });
  doc.font('Helvetica').fillColor(ink);

  if (order.customer_notes) {
    doc.moveDown(2);
    doc.fontSize(10).fillColor(accent).font(FONT_BOLD).text(`${ar('ملاحظات')} / Notes`);
    doc.fontSize(9).fillColor(ink).font(FONT).text(ar(order.customer_notes), { width: 495 });
  }

  // ---- Footer (QR + notes) ----
  const footerY = 720;
  const qrUrl = verifyUrl || `${settings.site_url || ''}/order/${order.order_number}`;
  try {
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', margin: 1, width: 110 });
    const qrBuf = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    doc.image(qrBuf, 50, footerY - 60, { width: 70 });
  } catch (e) { console.error('[invoice] QR generation failed:', e.message); }

  doc.fontSize(8).fillColor(muted).font('Helvetica');
  doc.text(
    "Cette facture est générée automatiquement et sert de preuve d'achat.",
    140, footerY - 50, { width: 405, align: 'left' },
  );
  doc.font(FONT).text(
    ar('هذه الفاتورة تم إنشاؤها تلقائياً وتشكل إثبات الشراء.'),
    140, footerY - 38, { width: 405, align: 'left' },
  );
  doc.fontSize(7).fillColor(muted).font('Helvetica').text(
    `Vérifier l'authenticité / ${ar('للتحقق من صحة الفاتورة')}: ${qrUrl}`,
    140, footerY - 22, { width: 405, align: 'left' },
  );

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

  const existing = db.prepare('SELECT * FROM invoices WHERE order_id = ?').get(orderId);
  if (existing && fs.existsSync(existing.pdf_path)) {
    return { invoiceNumber: existing.invoice_number, pdfPath: existing.pdf_path, cached: true };
  }

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

  db.prepare(
    `INSERT INTO invoices (order_id, invoice_number, pdf_path)
     VALUES (?, ?, ?)
     ON CONFLICT(order_id) DO UPDATE SET
       invoice_number = excluded.invoice_number,
       pdf_path = excluded.pdf_path,
       generated_at = CURRENT_TIMESTAMP`,
  ).run(orderId, invoiceNumber, finalPath);

  return { invoiceNumber, pdfPath: finalPath, cached: false };
}

module.exports = {
  generateInvoiceForOrder,
  streamInvoice,
  generateInvoiceNumber,
  INVOICE_DIR,
};
