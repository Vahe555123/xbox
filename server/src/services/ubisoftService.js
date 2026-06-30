const axios = require('axios');
const { randomUUID } = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const { extractDescription } = require('../utils/digisellerDescription');

const DIGISELLER_API = 'https://api.digiseller.ru/api/products/{id}/data';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = { data: null, expiresAt: 0 };

function leaf(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`));
  if (!m) return '';
  return (m[1] !== undefined ? m[1] : m[2] || '').trim();
}

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
      type: leaf(block, 'type'),
      variants,
    };
  });

  return { id, name, basePrice, currency, options, description: extractDescription(productInner) };
}

async function fetchUbisoftData(productId) {
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

    logger.info('[Ubisoft+] Fetched fresh data from Digiseller', {
      productId,
      basePrice: parsed.basePrice,
      options: parsed.options.length,
    });

    cache = { data: parsed, expiresAt: now + CACHE_TTL_MS };
    return parsed;
  } catch (err) {
    logger.warn('[Ubisoft+] Digiseller fetch failed', { message: err.message });
    if (cache.data) return cache.data;
    throw err;
  }
}

async function createUbisoftOrder(selections = {}, productId) {
  const product = await fetchUbisoftData(productId);

  const totalPrice = product.basePrice + (product.options || []).reduce((sum, opt) => {
    const selVal = selections[opt.id];
    if (!selVal) return sum;
    const variant = opt.variants.find((v) => v.value === selVal);
    return sum + (variant?.modifyValue || 0);
  }, 0);

  const digiuid = randomUUID().toUpperCase();
  const failPage = 'https://xboxtracker.ru/';

  const optionFields = {};
  for (const opt of product.options || []) {
    const selVal = selections[opt.id];
    if (!selVal) continue;
    if (opt.type === 'radio') {
      optionFields[`Option_radio_${opt.id}`] = String(selVal);
    } else if (opt.type === 'checkbox') {
      optionFields[`Option_checkbox_${opt.id}`] = String(selVal);
    } else {
      optionFields[`Option_text_${opt.id}`] = String(selVal);
    }
  }

  const body = new URLSearchParams({
    Lang: 'ru-RU',
    ID_D: String(productId),
    product_id: String(productId),
    Agent: config.digiseller.sellerId || '',
    AgentN: '',
    FailPage: failPage,
    NoClearBuyerQueryString: 'NoClear',
    digiuid,
    Curr_add: '',
    TypeCurr: 'API_17432_RUB',
    _subcurr: '',
    _ow: '0',
    firstrun: '0',
    unit_cnt: '1',
    unit_amount: String(totalPrice),
    product_cnt: '1',
    Email: '',
    ...optionFields,
  });

  const payPostUrl = config.digiseller.payPostUrl || 'https://www.oplata.info/asp2/pay.asp';

  const response = await axios.post(payPostUrl, body.toString(), {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://www.oplata.info',
      Pragma: 'no-cache',
      Referer: 'https://www.oplata.info/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    timeout: 15_000,
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const location = response.headers?.location || '';
  const idPoMatch = location.match(/[?&]id_po=([^&]+)/i);
  const idPo = idPoMatch ? decodeURIComponent(idPoMatch[1]) : null;

  if (!idPo) {
    logger.warn('[Ubisoft+] No id_po from Digiseller', { status: response.status, location });
    throw new Error('Не удалось создать заказ на Digiseller');
  }

  const payUrl = new URL('https://www.oplata.info/asp2/pay_api.asp');
  payUrl.searchParams.set('id_d', String(productId));
  payUrl.searchParams.set('id_po', idPo);
  payUrl.searchParams.set('cart_uid', '');
  payUrl.searchParams.set('ai', config.digiseller.sellerId || '');
  payUrl.searchParams.set('curr', 'API_17432_RUB');
  payUrl.searchParams.set('lang', 'ru-RU');
  payUrl.searchParams.set('digiuid', digiuid);
  payUrl.searchParams.set('_ow', '0');
  payUrl.searchParams.set('failpage', failPage);

  logger.info('[Ubisoft+] Order created', { productId, idPo, totalPrice });

  return { payUrl: payUrl.toString(), idPo };
}

module.exports = { fetchUbisoftData, createUbisoftOrder };
