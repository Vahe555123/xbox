const app = require('./app');
const dns = require('dns');
const config = require('./config');
const logger = require('./utils/logger');
const { initDb } = require('./db/schema');
const dealScheduler = require('./services/dealScheduler');
const russianLanguageIndexScheduler = require('./services/russianLanguageIndexScheduler');
const collectionsScheduler = require('./services/collectionsScheduler');
const priceRateScheduler = require('./services/priceRateScheduler');
const topupCardScheduler = require('./services/topupCardScheduler');
const saleIndexScheduler = require('./services/saleIndexScheduler');
const telegramBotService = require('./services/telegramBotService');
const { initCacheSettings } = require('./services/cacheSettingsService');

let server;

try {
  dns.setDefaultResultOrder('ipv4first');
} catch (_err) {
  // Older Node versions may not support this. SMTP still has its own timeouts.
}

initDb()
  .then(() => {
    return initCacheSettings();
  })
  .then(() => {
    server = app.listen(config.port, () => {
      logger.info(`Server running on http://localhost:${config.port} [${config.nodeEnv}]`);
    });

    dealScheduler.start();
    russianLanguageIndexScheduler.start();
    collectionsScheduler.start();
    priceRateScheduler.start();
    topupCardScheduler.start();
    saleIndexScheduler.start();
    telegramBotService.startPolling();
  })
  .catch((err) => {
    logger.error('Failed to initialize PostgreSQL', {
      message: err.message,
      code: err.code,
    });
    process.exit(1);
  });

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection', { message: err.message, stack: err.stack });
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down');
  dealScheduler.stop();
  russianLanguageIndexScheduler.stop();
  collectionsScheduler.stop();
  priceRateScheduler.stop();
  topupCardScheduler.stop();
  saleIndexScheduler.stop();
  telegramBotService.stopPolling();
  if (server) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
});
