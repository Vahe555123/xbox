const nodemailer = require('nodemailer');
const config = require('../config');
const { getChatIdForUser, sendTelegramMessage } = require('./telegramBotService');
const logger = require('../utils/logger');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function createTransport() {
  return nodemailer.createTransport({
    host: config.auth.smtp.host,
    port: config.auth.smtp.port,
    secure: config.auth.smtp.secure,
    family: config.auth.smtp.family,
    connectionTimeout: config.auth.smtp.connectionTimeoutMs,
    greetingTimeout: config.auth.smtp.greetingTimeoutMs,
    socketTimeout: config.auth.smtp.socketTimeoutMs,
    auth: {
      user: config.auth.smtp.username,
      pass: config.auth.smtp.password,
    },
  });
}

function getFromAddress() {
  if (config.auth.smtp.from) return config.auth.smtp.from;
  if (!config.auth.smtp.fromEmail) return config.auth.smtp.username;
  return `"${config.auth.smtp.fromName}" <${config.auth.smtp.fromEmail}>`;
}

async function getTelegramChatId(userId) {
  return getChatIdForUser(userId);
}

async function resolvePurchaseDeliveryTarget({ user, purchaseEmail, registrationEmail }) {
  const email = normalizeEmail(purchaseEmail) || normalizeEmail(registrationEmail || user?.email);
  if (email) return { type: 'email', email };

  const chatId = await getTelegramChatId(user?.id);
  if (chatId) return { type: 'telegram', chatId };

  return { type: 'none' };
}

function buildBuyerEmailForPayment(target) {
  if (target?.email) return target.email;
  if (target?.type === 'telegram' && target.chatId) {
    if (config.digiseller.fallbackBuyerEmail) return config.digiseller.fallbackBuyerEmail;
    const safeChatId = String(target.chatId).replace(/[^0-9_-]/g, '');
    return `telegram-${safeChatId || 'buyer'}@x-box-store.ru`;
  }
  return '';
}

async function notifyPurchaseCreated({ target, product, payment }) {
  if (!target || target.type === 'none') return { sent: false, channel: 'none' };
  if (!payment?.paymentUrl) return { sent: false, channel: target.type, reason: 'missing_payment_url' };

  if (target.type === 'email') {
    await sendPurchaseEmail(target.email, product, payment);
    return { sent: true, channel: 'email', to: target.email };
  }

  if (target.type === 'telegram') {
    await sendPurchaseTelegram(target.chatId, product, payment);
    return { sent: true, channel: 'telegram', to: target.chatId };
  }

  return { sent: false, channel: target.type };
}

async function sendPurchaseEmail(email, product, payment) {
  const transporter = createTransport();
  const title = product?.title || 'Xbox товар';
  const priceText = getPaymentPriceText(payment);
  const html = `
<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0d0f14;font-family:Arial,sans-serif;color:#f4f7fb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0f14;padding:24px 12px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#151922;border:1px solid #2a3240;border-radius:12px;">
        <tr><td style="padding:22px 24px;">
          <div style="color:#8df58d;font-size:13px;font-weight:700;text-transform:uppercase;margin-bottom:8px;">Xbox Store</div>
          <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:#fff;">Ссылка на оплату готова</h1>
          <p style="font-size:15px;line-height:1.5;margin:0 0 12px;color:#c8d0dc;">${escapeHtml(title)}</p>
          ${priceText ? `<p style="font-size:16px;margin:0 0 20px;color:#8df58d;font-weight:700;">${escapeHtml(priceText)}</p>` : ''}
          <a href="${escapeHtml(payment.paymentUrl)}" style="display:inline-block;background:#8df58d;color:#061006;text-decoration:none;font-weight:700;border-radius:8px;padding:12px 18px;">Открыть оплату</a>
          <p style="font-size:12px;line-height:1.45;margin:20px 0 0;color:#8b96a8;">Если кнопка не открывается, используйте ссылку:<br>${escapeHtml(payment.paymentUrl)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: getFromAddress(),
    to: email,
    subject: `Ссылка на оплату: ${title}`,
    text: [
      'Ссылка на оплату готова.',
      '',
      title,
      priceText || '',
      payment.paymentUrl,
    ].filter(Boolean).join('\n'),
    html,
  });
}

async function sendPurchaseTelegram(chatId, product, payment) {
  const title = product?.title || 'Xbox товар';
  const priceText = getPaymentPriceText(payment);
  const text = [
    'Ссылка на оплату готова.',
    '',
    title,
    priceText || '',
    '',
    payment.paymentUrl,
  ].filter(Boolean).join('\n');

  await sendTelegramMessage(chatId, text, { disableWebPagePreview: false });
}

function getPaymentPriceText(payment) {
  return payment?.amountRubFormatted
    || payment?.totalRubFormatted
    || payment?.priceRubFormatted
    || payment?.price?.formatted
    || null;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  resolvePurchaseDeliveryTarget,
  buildBuyerEmailForPayment,
  notifyPurchaseCreated,
  getTelegramChatId,
};
