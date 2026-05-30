const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

function createAxiosClient(baseURL = config.xbox.catalogBaseUrl) {
  const client = axios.create({
    baseURL,
    timeout: config.axios.timeout,
    headers: {
      'Accept': 'application/json',
      'Accept-Language': config.xbox.language,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    },
  });

  client.interceptors.request.use((req) => {
    logger.debug(`→ ${req.method.toUpperCase()} ${req.baseURL}${req.url}`, {
      params: req.params,
    });
    return req;
  });

  client.interceptors.response.use(
    (res) => {
      logger.debug(`← ${res.status} ${res.config.url}`);
      return res;
    },
    (err) => {
      logger.error(`← Request failed: ${err.message}`, {
        url: err.config?.url,
        status: err.response?.status,
      });
      return Promise.reject(err);
    },
  );

  return client;
}

function isRetryableRequestError(err) {
  const status = err?.response?.status;
  return !status || status >= 500 || status === 429;
}

function normalizeRetryOptions(optionsOrRetries, legacyDelay) {
  if (typeof optionsOrRetries === 'object' && optionsOrRetries !== null) {
    return {
      retries: Math.max(0, Number(optionsOrRetries.retries) || 0),
      delay: Math.max(0, Number(optionsOrRetries.delay) || 0),
      shouldRetry: typeof optionsOrRetries.shouldRetry === 'function'
        ? optionsOrRetries.shouldRetry
        : isRetryableRequestError,
    };
  }

  return {
    retries: Math.max(0, Number(optionsOrRetries) || 0),
    delay: Math.max(0, Number(legacyDelay) || 0),
    shouldRetry: isRetryableRequestError,
  };
}

async function withRetry(
  fn,
  optionsOrRetries = config.axios.retryCount,
  legacyDelay = config.axios.retryDelay,
) {
  const { retries, delay, shouldRetry } = normalizeRetryOptions(optionsOrRetries, legacyDelay);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries && shouldRetry(err)) {
        const wait = delay * Math.pow(2, attempt);
        logger.warn(`Retry ${attempt + 1}/${retries} in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        break;
      }
    }
  }
  throw lastError;
}

module.exports = { createAxiosClient, withRetry, isRetryableRequestError };
