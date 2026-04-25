const fs = require('fs');
const path = require('path');
const { Blob } = require('buffer');
const axios = require('axios');
const config = require('../config');
const pool = require('../db/pool');
const logger = require('../utils/logger');

let pollingTimer = null;
let pollingOffset = 0;
let pollingInFlight = false;

function hasBotToken() {
  return Boolean(config.auth.telegram.botToken);
}

function apiUrl(method) {
  return `https://api.telegram.org/bot${config.auth.telegram.botToken}/${method}`;
}

async function callTelegram(method, payload = {}, options = {}) {
  if (!hasBotToken()) {
    throw new Error('Telegram bot token is not configured');
  }

  let data;
  try {
    const response = await axios.post(apiUrl(method), payload, {
      timeout: options.timeout || config.auth.telegram.requestTimeoutMs,
    });
    data = response.data;
  } catch (err) {
    const description = err.response?.data?.description || err.message;
    const wrapped = new Error(description);
    wrapped.status = err.response?.status;
    wrapped.telegramDescription = description;
    throw wrapped;
  }

  if (!data?.ok) {
    const description = data?.description || `Telegram ${method} failed`;
    const err = new Error(description);
    err.telegramDescription = description;
    throw err;
  }

  return data.result;
}

function guessContentType(filename) {
  const ext = String(path.extname(filename || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

async function callTelegramMultipart(method, formData, options = {}) {
  if (!hasBotToken()) {
    throw new Error('Telegram bot token is not configured');
  }

  let data;
  try {
    const response = await axios.post(apiUrl(method), formData, {
      timeout: options.timeout || config.auth.telegram.requestTimeoutMs,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    data = response.data;
  } catch (err) {
    const description = err.response?.data?.description || err.message;
    const wrapped = new Error(description);
    wrapped.status = err.response?.status;
    wrapped.telegramDescription = description;
    throw wrapped;
  }

  if (!data?.ok) {
    const description = data?.description || `Telegram ${method} failed`;
    const err = new Error(description);
    err.telegramDescription = description;
    throw err;
  }

  return data.result;
}

function stripTelegramMarkdown(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2')
    .replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1')
    .replace(/[*_~`]/g, '');
}

async function sendTelegramMessage(chatId, text, options = {}) {
  if (!chatId) {
    throw new Error('Telegram chat_id is missing. Ask the user to press /start in the bot.');
  }

  const payload = {
    chat_id: chatId,
    text,
    disable_web_page_preview: options.disableWebPagePreview ?? false,
  };
  if (options.parseMode) payload.parse_mode = options.parseMode;

  try {
    return await callTelegram('sendMessage', payload);
  } catch (err) {
    const description = err.telegramDescription || err.message;
    if (options.parseMode && /parse entities|can't parse/i.test(description)) {
      logger.warn('[TelegramBot] Markdown failed, retrying as plain text', { message: description });
      return callTelegram('sendMessage', {
        chat_id: chatId,
        text: stripTelegramMarkdown(text),
        disable_web_page_preview: options.disableWebPagePreview ?? false,
      });
    }
    throw err;
  }
}

async function sendTelegramPhoto(chatId, photoPath, options = {}) {
  if (!chatId) {
    throw new Error('Telegram chat_id is missing. Ask the user to press /start in the bot.');
  }

  if (!photoPath) {
    throw new Error('Telegram photo path is missing');
  }

  if (typeof FormData !== 'function') {
    throw new Error('FormData is not available in this Node runtime');
  }

  const resolvedPath = path.resolve(String(photoPath));
  const fileBuffer = await fs.promises.readFile(resolvedPath);
  const filename = options.filename || path.basename(resolvedPath);
  const contentType = options.contentType || guessContentType(filename);

  const formData = new FormData();
  formData.append('chat_id', String(chatId));
  formData.append('photo', new Blob([fileBuffer], { type: contentType }), filename);

  if (options.caption) formData.append('caption', options.caption);
  if (options.parseMode) formData.append('parse_mode', options.parseMode);
  if (options.disableNotification !== undefined) {
    formData.append('disable_notification', String(Boolean(options.disableNotification)));
  }

  return callTelegramMultipart('sendPhoto', formData, options);
}

async function findLinkedUserId(telegramUserId) {
  const { rows } = await pool.query(
    `SELECT user_id FROM oauth_accounts
     WHERE provider = 'telegram' AND provider_user_id = $1
     LIMIT 1`,
    [String(telegramUserId)],
  );
  return rows[0]?.user_id || null;
}

async function upsertTelegramChatFromMessage(message) {
  const from = message?.from;
  const chat = message?.chat;
  if (!from?.id || !chat?.id || chat.type !== 'private') return null;

  const telegramUserId = String(from.id);
  const chatId = String(chat.id);
  const linkedUserId = await findLinkedUserId(telegramUserId);

  const { rows } = await pool.query(
    `INSERT INTO telegram_bot_chats
       (telegram_user_id, chat_id, user_id, username, first_name, last_name, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (telegram_user_id)
     DO UPDATE SET
       chat_id = EXCLUDED.chat_id,
       user_id = COALESCE(EXCLUDED.user_id, telegram_bot_chats.user_id),
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       last_seen_at = NOW()
     RETURNING *`,
    [
      telegramUserId,
      chatId,
      linkedUserId,
      from.username || null,
      from.first_name || null,
      from.last_name || null,
    ],
  );

  return rows[0] || null;
}

async function linkTelegramChatToUser(userId, telegramUserId) {
  if (!userId || !telegramUserId) return;
  await pool.query(
    `UPDATE telegram_bot_chats
     SET user_id = $1, last_seen_at = NOW()
     WHERE telegram_user_id = $2`,
    [userId, String(telegramUserId)],
  );
}

async function getChatIdForUser(userId) {
  if (!userId) return null;
  const { rows } = await pool.query(
    `SELECT tbc.chat_id
     FROM oauth_accounts oa
     JOIN telegram_bot_chats tbc
       ON tbc.telegram_user_id = oa.provider_user_id
     WHERE oa.user_id = $1
       AND oa.provider = 'telegram'
     ORDER BY tbc.last_seen_at DESC
     LIMIT 1`,
    [userId],
  );
  return rows[0]?.chat_id || null;
}

async function handleTelegramUpdate(update) {
  const message = update?.message;
  if (!message) return;

  const chatRecord = await upsertTelegramChatFromMessage(message);
  if (!chatRecord) return;

  const text = String(message.text || '').trim();
  if (!text) return;

  if (text.startsWith('/start')) {
    const linkedText = chatRecord.user_id
      ? 'Бот подключен к вашему аккаунту. Сюда будут приходить ссылки на оплату и уведомления по избранным играм.'
      : 'Бот запущен. Чтобы привязать его к аккаунту, войдите на сайте через Telegram, затем снова нажмите /start.';
    await sendTelegramMessage(chatRecord.chat_id, linkedText, { disableWebPagePreview: true });
    return;
  }

  if (text.startsWith('/id')) {
    await sendTelegramMessage(chatRecord.chat_id, `Ваш chat_id: ${chatRecord.chat_id}`, {
      disableWebPagePreview: true,
    });
    return;
  }

  if (text.startsWith('/help')) {
    await sendTelegramMessage(
      chatRecord.chat_id,
      'Нажмите /start, чтобы подключить уведомления. Если аккаунт еще не привязан, войдите на сайте через Telegram.',
      { disableWebPagePreview: true },
    );
  }
}

async function pollOnce() {
  if (!hasBotToken() || pollingInFlight) return;
  pollingInFlight = true;

  try {
    const { data } = await axios.get(apiUrl('getUpdates'), {
      params: {
        offset: pollingOffset || undefined,
        timeout: 20,
        allowed_updates: JSON.stringify(['message']),
      },
      timeout: 25000,
    });

    if (!data?.ok) {
      throw new Error(data?.description || 'Telegram getUpdates failed');
    }

    for (const update of data.result || []) {
      pollingOffset = Math.max(pollingOffset, Number(update.update_id) + 1);
      await handleTelegramUpdate(update);
    }
  } catch (err) {
    logger.error('[TelegramBot] Polling failed', { message: err.message });
  } finally {
    pollingInFlight = false;
  }
}

async function deleteWebhookForPolling() {
  try {
    await callTelegram('deleteWebhook', { drop_pending_updates: false });
    logger.info('[TelegramBot] Webhook disabled, polling mode is active');
  } catch (err) {
    logger.error('[TelegramBot] Failed to disable webhook before polling', { message: err.message });
  }
}

function scheduleNextPoll() {
  if (pollingTimer) clearTimeout(pollingTimer);
  pollingTimer = setTimeout(async () => {
    await pollOnce();
    scheduleNextPoll();
  }, config.auth.telegram.pollIntervalMs);
}

function startPolling() {
  if (!hasBotToken()) {
    logger.warn('[TelegramBot] Bot token is not configured, polling disabled');
    return;
  }
  if (!config.auth.telegram.pollingEnabled) {
    logger.info('[TelegramBot] Polling disabled by config');
    return;
  }
  if (pollingTimer) return;

  logger.info('[TelegramBot] Polling starting without webhook');
  deleteWebhookForPolling().finally(() => {
    pollOnce().finally(scheduleNextPoll);
  });
}

function stopPolling() {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
}

module.exports = {
  getChatIdForUser,
  linkTelegramChatToUser,
  sendTelegramMessage,
  sendTelegramPhoto,
  startPolling,
  stopPolling,
};
