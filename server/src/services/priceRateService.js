const cache = require('../utils/cache');
const logger = require('../utils/logger');
const digisellerService = require('./digisellerService');
const topupCardService = require('./topupCardService');

/**
 * Converts the USD price-filter buckets to rubles using whichever of the three
 * purchase methods (Oplata, ключ активации, карты пополнения) is currently the
 * cheapest at each boundary. Used to label the "Цена" filter in rubles.
 */
const CACHE_KEY = 'price-filter-rub-boundaries';
const CACHE_TTL_SECONDS = 10 * 60;
const PRICE_BOUNDARIES_USD = [5, 10, 20, 40, 60];

function roundRub(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value / 10) * 10;
}

async function bestRubForUsd(usd) {
  const [oplata, keyActivation, topup] = await Promise.all([
    digisellerService.getUsdToRubEstimate(usd, 'oplata').catch(() => null),
    digisellerService.getUsdToRubEstimate(usd, 'key_activation').catch(() => null),
    topupCardService.computeCombo(usd).then((combo) => (combo?.available ? combo.totalRub : null)).catch(() => null),
  ]);

  const candidates = [oplata, keyActivation, topup]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  return candidates.length ? Math.min(...candidates) : null;
}

async function getPriceFilterRubBoundaries() {
  const cached = cache.get(CACHE_KEY);
  if (cached) return cached;

  const boundaries = {};
  try {
    await Promise.all(PRICE_BOUNDARIES_USD.map(async (usd) => {
      boundaries[usd] = roundRub(await bestRubForUsd(usd));
    }));
  } catch (err) {
    logger.warn('Failed to compute price filter RUB boundaries', { message: err.message });
  }

  const result = { boundaries, currency: 'RUB' };
  cache.set(CACHE_KEY, result, CACHE_TTL_SECONDS);
  return result;
}

module.exports = { getPriceFilterRubBoundaries, PRICE_BOUNDARIES_USD };
