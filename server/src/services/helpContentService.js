const pool = require('../db/pool');

const HELP_CONTENT_KEY = 'help';

const DEFAULT_HELP_CONTENT = {
  eyebrow: 'Помощь',
  title: 'Как купить игру, получить оплату и быстро связаться с поддержкой',
  subtitle: 'Здесь собраны основные ответы по покупке игр, оплате и связи с поддержкой. Большую часть текста можно менять прямо из админки.',
  supportTitle: 'Написать в поддержку',
  supportDescription: 'Если нужна помощь с оплатой, заказом или доступом к игре, свяжитесь с нами в удобном мессенджере.',
  supportButtonLabel: 'Открыть поддержку',
  supportButtonUrl: '',
  purchasesTitle: 'Как проходит покупка',
  purchasesDescription: 'Покупка оформляется через ссылку на оплату. После оплаты дальнейшая информация приходит на почту для покупки или в переписке с продавцом.',
  purchasesButtonLabel: 'Перейти к оплате',
  purchasesButtonUrl: 'https://oplata.info',
  steps: [
    {
      title: '1. Найдите нужную игру',
      body: 'Откройте страницу товара, проверьте цену, язык и подходящий способ покупки.',
    },
    {
      title: '2. Выберите способ оплаты',
      body: 'Используйте подходящий вариант: спецпредложение, покупка на аккаунт, ключ или карты пополнения.',
    },
    {
      title: '3. Получите дальнейшие инструкции',
      body: 'После оплаты ориентируйтесь на письмо для покупки и сообщения от продавца или поддержки.',
    },
  ],
  faqItems: [
    {
      question: 'Куда приходит информация после оплаты?',
      answer: 'Обычно инструкция и дальнейшие шаги приходят на почту, указанную для покупки.',
    },
    {
      question: 'Что делать, если оплата прошла, но есть вопрос по заказу?',
      answer: 'Напишите в поддержку через Telegram, VK или MAX и укажите, по какому заказу нужен ответ.',
    },
    {
      question: 'Можно ли сначала уточнить детали перед покупкой?',
      answer: 'Да, вы можете заранее открыть раздел помощи и написать в поддержку до оплаты.',
    },
  ],
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeArray(items, mapper) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => mapper(item || {}))
    .filter((item) => Object.values(item).some(Boolean));
}

function normalizeHelpContent(payload = {}) {
  const steps = normalizeArray(payload.steps, (item) => ({
    title: normalizeText(item.title),
    body: normalizeText(item.body),
  }));
  const faqItems = normalizeArray(payload.faqItems, (item) => ({
    question: normalizeText(item.question),
    answer: normalizeText(item.answer),
  }));

  return {
    eyebrow: normalizeText(payload.eyebrow),
    title: normalizeText(payload.title),
    subtitle: normalizeText(payload.subtitle),
    supportTitle: normalizeText(payload.supportTitle),
    supportDescription: normalizeText(payload.supportDescription),
    supportButtonLabel: normalizeText(payload.supportButtonLabel),
    supportButtonUrl: normalizeText(payload.supportButtonUrl),
    purchasesTitle: normalizeText(payload.purchasesTitle),
    purchasesDescription: normalizeText(payload.purchasesDescription),
    purchasesButtonLabel: normalizeText(payload.purchasesButtonLabel),
    purchasesButtonUrl: normalizeText(payload.purchasesButtonUrl),
    steps,
    faqItems,
  };
}

function withDefaults(data = {}, updatedAt = null) {
  const normalized = normalizeHelpContent({
    ...DEFAULT_HELP_CONTENT,
    ...(data && typeof data === 'object' ? data : {}),
  });

  return {
    ...normalized,
    updatedAt,
  };
}

async function getHelpContent() {
  const { rows } = await pool.query(
    'SELECT data, updated_at FROM site_content WHERE key = $1',
    [HELP_CONTENT_KEY],
  );

  if (!rows[0]) {
    return withDefaults({}, null);
  }

  return withDefaults(rows[0].data, rows[0].updated_at || null);
}

async function updateHelpContent(payload = {}) {
  const data = normalizeHelpContent(payload);

  const { rows } = await pool.query(
    `INSERT INTO site_content (key, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET
       data = EXCLUDED.data,
       updated_at = NOW()
     RETURNING data, updated_at`,
    [HELP_CONTENT_KEY, data],
  );

  return withDefaults(rows[0]?.data, rows[0]?.updated_at || null);
}

module.exports = {
  getHelpContent,
  updateHelpContent,
};
