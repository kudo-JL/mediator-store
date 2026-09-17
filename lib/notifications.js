// lib/notifications.js
// Send admin notifications when a new order is placed.
// Supports Telegram (text + documents), WhatsApp via CallMeBot, and Email (SMTP).
// All channels are independent — if one fails, the others still try.

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { getSetting } = require('./db');

const TIMEOUT_MS = 8000;
const TIMEOUT_DOC_MS = 20000;

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegram(text) {
  const token = (getSetting('telegram_bot_token') || '').trim();
  const chatId = (getSetting('telegram_chat_id') || '').trim();
  if (!token || !chatId) return { ok: false, reason: 'not_configured' };
  try {
    const resp = await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true },
      { timeout: TIMEOUT_MS }
    );
    if (resp.data && resp.data.ok) return { ok: true };
    return { ok: false, error: resp.data && resp.data.description };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Send a file (e.g. invoice PDF) via Telegram Bot API.
 * Uses sendDocument endpoint.
 */
async function sendTelegramDocument(filePath, caption = '') {
  const token = (getSetting('telegram_bot_token') || '').trim();
  const chatId = (getSetting('telegram_chat_id') || '').trim();
  if (!token || !chatId) return { ok: false, reason: 'not_configured' };
  if (!fs.existsSync(filePath)) return { ok: false, error: 'file_not_found' };

  try {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('document', fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: 'application/pdf',
    });
    if (caption) form.append('caption', caption);
    form.append('parse_mode', 'HTML');

    const resp = await axios.post(
      `https://api.telegram.org/bot${token}/sendDocument`,
      form,
      { headers: form.getHeaders(), timeout: TIMEOUT_DOC_MS, maxBodyLength: 25 * 1024 * 1024, maxContentLength: 25 * 1024 * 1024 }
    );
    if (resp.data && resp.data.ok) return { ok: true };
    return { ok: false, error: resp.data && resp.data.description };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendWhatsApp(text) {
  const apiKey = (getSetting('callmebot_api_key') || '').trim();
  const phone = (getSetting('callmebot_phone') || '').trim();
  if (!apiKey || !phone) return { ok: false, reason: 'not_configured' };
  try {
    const url =
      'https://api.callmebot.com/whatsapp.php' +
      `?phone=${encodeURIComponent(phone)}` +
      `&text=${encodeURIComponent(text)}` +
      `&apikey=${encodeURIComponent(apiKey)}`;
    const resp = await axios.get(url, { timeout: TIMEOUT_MS });
    if (typeof resp.data === 'string' && /API activated/i.test(resp.data)) {
      return { ok: false, error: 'api_not_activated' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Send an invoice PDF via SMTP email.
 * Requires env vars:
 *   SMTP_HOST (default smtp.zoho.com)
 *   SMTP_PORT (default 465)
 *   SMTP_USER (default support@lotfi.ma)
 *   SMTP_PASS (required)
 *   INVOICE_FROM (default same as SMTP_USER)
 *   INVOICE_TO   (default same as SMTP_USER)
 */
async function sendInvoiceEmail({ to, subject, text, pdfPath }) {
  const host = process.env.SMTP_HOST || 'smtp.zoho.com';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const user = process.env.SMTP_USER || 'support@lotfi.ma';
  const pass = process.env.SMTP_PASS;
  const from = process.env.INVOICE_FROM || user;
  const recipient = to || process.env.INVOICE_TO || user;

  if (!pass) return { ok: false, reason: 'smtp_not_configured' };
  if (!fs.existsSync(pdfPath)) return { ok: false, error: 'file_not_found' };

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host, port, secure: port === 465,
      auth: { user, pass },
    });
    const info = await transporter.sendMail({
      from,
      to: recipient,
      subject: subject || 'فاتورة جديدة',
      text: text || 'مرفق فاتورة الطلب.',
      attachments: [{ filename: path.basename(pdfPath), path: pdfPath }],
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function buildOrderMessage(order, currency) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsLine = items.slice(0, 5).map((it) => `  • ${it.product_name} ×${it.quantity}`).join('\n');
  const more = items.length > 5 ? `\n  … و ${items.length - 5} منتوج آخر` : '';
  return [
    '🛒 طلب جديد',
    `🔖 رقم الطلب: <b>#${escapeHtml(order.order_number || '')}</b>`,
    '',
    `👤 الاسم: ${escapeHtml(order.customer_name || '')}`,
    `📞 الهاتف: <code>${escapeHtml(order.customer_phone || '')}</code>`,
    order.customer_city ? `🏙️ المدينة: ${escapeHtml(order.customer_city)}` : null,
    order.customer_address ? `📍 العنوان: ${escapeHtml(order.customer_address)}` : null,
    order.customer_notes ? `📝 ملاحظات: ${escapeHtml(order.customer_notes)}` : null,
    '',
    `🧾 عدد المنتوجات: ${items.length}`,
    itemsLine ? `🛍️ المنتوجات:\n${escapeHtml(itemsLine)}${more}` : null,
    '',
    `💰 الإجمالي: <b>${Number(order.total || 0).toFixed(2)} ${escapeHtml(currency || '')}</b>`,
    `🚚 الشحن: ${Number(order.shipping || 0).toFixed(2)} ${escapeHtml(currency || '')}`,
    `💳 الدفع: ${escapeHtml(order.payment_method || 'cod')}`,
  ].filter((l) => l !== null).join('\n');
}

async function notifyNewOrder(order) {
  const currency = getSetting('store_currency', 'د.م.');
  const message = buildOrderMessage(order, currency);
  const [tg, wa] = await Promise.allSettled([
    sendTelegram(message),
    sendWhatsApp(message),
  ]);
  return {
    telegram: tg.status === 'fulfilled' ? tg.value : { ok: false, error: tg.reason && tg.reason.message },
    whatsapp: wa.status === 'fulfilled' ? wa.value : { ok: false, error: wa.reason && wa.reason.message },
  };
}

/**
 * Send invoice PDF to admin (email + Telegram document) when an order is delivered.
 */
async function notifyInvoiceReady({ order, invoiceNumber, pdfPath }) {
  const currency = getSetting('store_currency', 'د.م.');
  const caption = [
    '📄 فاتورة جديدة للتسليم',
    `🔖 الطلب: <b>#${escapeHtml(order.order_number || '')}</b>`,
    `🧾 الفاتورة: <b>${escapeHtml(invoiceNumber)}</b>`,
    `👤 ${escapeHtml(order.customer_name || '')}`,
    `💰 الإجمالي: <b>${Number(order.total || 0).toFixed(2)} ${escapeHtml(currency)}</b>`,
  ].join('\n');

  const emailSubject = `فاتورة ${invoiceNumber} - طلب #${order.order_number}`;
  const emailText = [
    `فاتورة الطلب: ${order.order_number}`,
    `رقم الفاتورة: ${invoiceNumber}`,
    `الزبون: ${order.customer_name}`,
    `الهاتف: ${order.customer_phone}`,
    `المجموع: ${order.total} ${currency}`,
    '',
    'مرفق نسخة من الفاتورة PDF. الرجاء إرسالها للزبون يدوياً.',
  ].join('\n');

  const [email, telegram] = await Promise.allSettled([
    sendInvoiceEmail({ subject: emailSubject, text: emailText, pdfPath }),
    sendTelegramDocument(pdfPath, caption),
  ]);
  return {
    email: email.status === 'fulfilled' ? email.value : { ok: false, error: email.reason && email.reason.message },
    telegram: telegram.status === 'fulfilled' ? telegram.value : { ok: false, error: telegram.reason && telegram.reason.message },
  };
}

async function sendTest(channel) {
  const currency = getSetting('store_currency', 'د.م.');
  const text = [
    '🧪 رسالة اختبار',
    '',
    'هذه رسالة اختبار من <b>متجر الوسيط</b>.',
    'لو شفتها، الإشعارات تشتغل تمام ✅',
  ].join('\n');
  if (channel === 'telegram') return await sendTelegram(text);
  if (channel === 'whatsapp') return await sendWhatsApp(text);
  return { ok: false, error: 'unknown_channel' };
}

module.exports = {
  sendTelegram,
  sendTelegramDocument,
  sendWhatsApp,
  sendInvoiceEmail,
  notifyNewOrder,
  notifyInvoiceReady,
  sendTest,
  buildOrderMessage,
};
