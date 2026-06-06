const axios = require('axios');
const logger = require('../utils/logger');

const DIGISELLER_API = 'https://api.digiseller.ru/api/products/{id}/data';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

let cache = { data: null, expiresAt: 0 };

// Returns the text content of the FIRST matching tag (handles CDATA and plain text)
function leaf(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`));
  if (!m) return '';
  return (m[1] !== undefined ? m[1] : m[2] || '').trim();
}

// Returns inner contents of ALL matching top-level tags (handles nested tags correctly)
function extractAll(xml, tag) {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const results = [];
  let pos = 0;
  while (pos < xml.length) {
    const start = xml.indexOf(open, pos);
    if (start === -1) break;
    const openEnd = xml.indexOf('>', start);
    if (openEnd === -1) break;
    const end = xml.indexOf(close, openEnd);
    if (end === -1) break;
    results.push(xml.slice(openEnd + 1, end).trim());
    pos = end + close.length;
  }
  return results;
}

function parseProduct(xml) {
  const productInner = extractAll(xml, 'product')[0] || '';
  if (!productInner) return null;

  const basePrice = parseInt(leaf(productInner, 'price'), 10) || 0;
  const name = leaf(productInner, 'name');
  const currency = leaf(productInner, 'currency') || 'RUB';
  const id = leaf(productInner, 'id');

  const optionBlocks = extractAll(productInner, 'option');
  const options = optionBlocks.map((block) => {
    const variants = extractAll(block, 'variant').map((vb) => ({
      value: leaf(vb, 'value'),
      text: leaf(vb, 'text'),
      modifyValue: parseInt(leaf(vb, 'modify_value'), 10) || 0,
      modifyType: leaf(vb, 'modify_type') || currency,
    }));
    return {
      id: leaf(block, 'id'),
      label: leaf(block, 'label'),
      type: leaf(block, 'type'), // 'radio' | 'checkbox'
      variants,
    };
  });

  return { id, name, basePrice, currency, options };
}

async function fetchGamePassData(productId = 4687274) {
  const now = Date.now();
  if (cache.data && cache.expiresAt > now) return cache.data;

  const url = DIGISELLER_API.replace('{id}', productId);
  try {
    const { data } = await axios.get(url, {
      params: { currency: 'RUB', lang: 'ru-RU', owner: 1 },
      timeout: 10_000,
      headers: { Accept: 'application/xml, text/xml, */*' },
    });

    const parsed = parseProduct(String(data));
    if (!parsed) throw new Error('Empty or unrecognised Digiseller response');

    logger.info('[GamePass] Fetched fresh data from Digiseller', {
      productId,
      basePrice: parsed.basePrice,
      options: parsed.options.length,
    });

    cache = { data: parsed, expiresAt: now + CACHE_TTL_MS };
    return parsed;
  } catch (err) {
    logger.warn('[GamePass] Digiseller fetch failed', { message: err.message });
    if (cache.data) return cache.data; // serve stale data on error
    throw err;
  }
}

module.exports = { fetchGamePassData };
