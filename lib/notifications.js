// lib/notifications.js
// Send admin notifications when a new order is placed.
// Supports Telegram (free, official Bot API) and WhatsApp via CallMeBot (free, simple).
// Both channels are independent — if one fails, the other still tries.

const axios = require('axios');
const { getSetting } = require('./db');

const TIMEOUT_MS = 8000;

/** Escape HTML special chars for Telegram. */
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Send a message via Telegram Bot API.
 * Requires:
 *   - telegram_bot_token: from @BotFather on Telegram
 *   - telegram_chat_id:    numeric ID of the admin's chat with the bot
 */
async function sendTelegram(text) {
  const token = (getSetting('telegram_bot_token') || '').trim();
  const chatId = (getSetting('telegram_chat_id') || '').trim();
  if (!token || !chatId) {
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const resp = await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      { timeout: TIMEOUT_MS }
    );
    if (resp.data && resp.data.ok) return { ok: true };
    return { ok: false, error: resp.data && resp.data.description };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Send a WhatsApp message via CallMeBot.
 * Requires:
 *   - callmebot_api_key: API key returned by CallMeBot after activation
 *   - callmebot_phone:    admin's phone number in international format
 *
 * CallMeBot is a free gateway — no business account required.
 */
async function sendWhatsApp(text) {
  const apiKey = (getSetting('callmebot_api_key') || '').trim();
  const phone = (getSetting('callmebot_phone') || '').trim();
  if (!apiKey || !phone) {
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const url =
      'https://api.callmebot.com/whatsapp.php' +
      `?phone=${encodeURIComponent(phone)}` +
      `&text=${encodeURIComponent(text)}` +
      `&apikey=${encodeURIComponent(apiKey)}`;
    const resp = await axios.get(url, { timeout: TIMEOUT_MS });
    // CallMeBot returns plain text on success
    if (typeof resp.data === 'string' && /API activated/i.test(resp.data)) {
      return { ok: false, error: 'api_not_activated' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Build the notification body for a new order.
 */
function buildOrderMessage(order, currency) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsLine = items
    .slice(0, 5)
    .map((it) => `  • ${it.product_name} ×${it.quantity}`)
    .join('\n');
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
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/**
 * Send a new-order notification to every configured channel.
 * Does not throw — failures are returned in the result object.
 */
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

/** Test channel from the admin settings page. */
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
  sendWhatsApp,
  notifyNewOrder,
  sendTest,
  buildOrderMessage,
};
