const axios = require('axios');
const pool = require('../db/pool');
const config = require('../config');
const { sendBroadcastToChat } = require('./telegramBotService');
const { createSmtpTransport, getFromAddress } = require('./mailTransport');
const logger = require('../utils/logger');

// Strip HTML tags and convert links to readable form for plain-text channels.
function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function buildEmailHtml(text, photoUrl, buttons) {
  const body = String(text || '').replace(/\n/g, '<br>');
  const imgBlock = photoUrl
    ? `<p><img src="${photoUrl}" alt="" style="max-width:100%;border-radius:8px;"></p>`
    : '';
  const btnBlock = buttons && buttons.length > 0
    ? `<p>${buttons.map((b) => `<a href="${b.url}" style="display:inline-block;margin:4px 6px 4px 0;padding:10px 20px;background:#107c10;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">${b.text}</a>`).join('')}</p>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;">
<div style="max-width:600px;margin:32px auto;padding:24px;background:#fff;border-radius:12px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;">
${imgBlock}${body ? `<div>${body}</div>` : ''}${btnBlock}
</div></body></html>`;
}

async function broadcastTelegram(text, photoUrl, buttons) {
  const { rows: chats } = await pool.query(
    `SELECT DISTINCT chat_id FROM telegram_bot_chats WHERE chat_id IS NOT NULL`,
  );

  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const { chat_id } of chats) {
    try {
      await sendBroadcastToChat(chat_id, { text, photoUrl, buttons });
      sent++;
    } catch (err) {
      failed++;
      errors.push({ chatId: chat_id, error: err.message });
      logger.warn('[Broadcast] Telegram send failed', { chatId: chat_id, error: err.message });
    }
    // Telegram rate limit: ~30 msg/s per bot. 50ms gap is safe.
    await new Promise((r) => setTimeout(r, 50));
  }

  return { total: chats.length, sent, failed, errors };
}

async function broadcastEmail(subject, text, photoUrl, buttons) {
  if (!config.auth.smtp.host || !config.auth.smtp.username) {
    return { total: 0, sent: 0, failed: 0, errors: ['SMTP not configured'] };
  }

  const { rows: users } = await pool.query(
    `SELECT id, email, name FROM users WHERE email IS NOT NULL AND email <> '' ORDER BY created_at`,
  );

  const transport = createSmtpTransport();
  const from = getFromAddress();
  const htmlBody = buildEmailHtml(text, photoUrl, buttons);
  const plainBody = htmlToPlainText(text);

  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const user of users) {
    try {
      await transport.sendMail({
        from,
        to: user.email,
        subject: subject || 'Сообщение от XboxTracker',
        html: htmlBody,
        text: plainBody,
      });
      sent++;
    } catch (err) {
      failed++;
      errors.push({ email: user.email, error: err.message });
      logger.warn('[Broadcast] Email send failed', { email: user.email, error: err.message });
    }
    // Respect SMTP rate limits.
    await new Promise((r) => setTimeout(r, 100));
  }

  return { total: users.length, sent, failed, errors };
}

async function broadcastVk(text, photoUrl, buttons) {
  const communityToken = config.auth.vk.communityToken;
  if (!communityToken) {
    return { total: 0, sent: 0, failed: 0, errors: ['VK community token not configured (VK_COMMUNITY_TOKEN)'] };
  }

  const apiVersion = config.auth.vk.apiVersion || '5.199';

  // Get all VK user IDs from oauth_accounts.
  const { rows: accounts } = await pool.query(
    `SELECT provider_user_id FROM oauth_accounts WHERE provider = 'vk' AND provider_user_id IS NOT NULL`,
  );

  const plainText = htmlToPlainText(text);
  // Append button links as plain text for VK (no inline keyboard in direct messages).
  const vkText = buttons && buttons.length > 0
    ? `${plainText}\n\n${buttons.map((b) => `${b.text}: ${b.url}`).join('\n')}`
    : plainText;

  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const { provider_user_id } of accounts) {
    try {
      const params = new URLSearchParams({
        user_id: provider_user_id,
        message: vkText,
        random_id: String(Date.now() + Math.floor(Math.random() * 1e6)),
        access_token: communityToken,
        v: apiVersion,
      });
      if (photoUrl) params.append('attachment', photoUrl);

      const resp = await axios.post(
        `https://api.vk.com/method/messages.send`,
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 },
      );

      if (resp.data?.error) {
        throw new Error(resp.data.error.error_msg || 'VK API error');
      }
      sent++;
    } catch (err) {
      failed++;
      const msg = err.response?.data?.error?.error_msg || err.message;
      errors.push({ vkId: provider_user_id, error: msg });
      logger.warn('[Broadcast] VK send failed', { vkId: provider_user_id, error: msg });
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return { total: accounts.length, sent, failed, errors };
}

async function runBroadcast({ text, photoUrl, buttons, channels, emailSubject }) {
  const report = {};

  if (channels.telegram) {
    logger.info('[Broadcast] Starting Telegram broadcast');
    report.telegram = await broadcastTelegram(text, photoUrl, buttons);
    logger.info('[Broadcast] Telegram done', report.telegram);
  }

  if (channels.email) {
    logger.info('[Broadcast] Starting Email broadcast');
    report.email = await broadcastEmail(emailSubject, text, photoUrl, buttons);
    logger.info('[Broadcast] Email done', report.email);
  }

  if (channels.vk) {
    logger.info('[Broadcast] Starting VK broadcast');
    report.vk = await broadcastVk(text, photoUrl, buttons);
    logger.info('[Broadcast] VK done', report.vk);
  }

  return report;
}

module.exports = { runBroadcast };
