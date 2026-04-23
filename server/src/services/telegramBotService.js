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

  const { data } = await axios.post(apiUrl(method), payload, {
    timeout: options.timeout || config.auth.telegram.requestTimeoutMs,
  });

  if (!data?.ok) {
    throw new Error(data?.description || `Telegram ${method} failed`);
  }

  return data.result;
}

async function sendTelegramMessage(chatId, text, options = {}) {
  if (!chatId) {
    throw new Error('Telegram chat_id is missing. Ask the user to press /start in the bot.');
  }

  return callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: options.parseMode,
    disable_web_page_preview: options.disableWebPagePreview ?? false,
  });
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

async function handleWebhookUpdate(update) {
  try {
    await handleTelegramUpdate(update);
  } catch (err) {
    logger.error('[TelegramBot] Webhook update failed', { message: err.message });
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
  handleWebhookUpdate,
  linkTelegramChatToUser,
  sendTelegramMessage,
  startPolling,
  stopPolling,
};
