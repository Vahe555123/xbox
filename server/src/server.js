const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const { initDb } = require('./db/schema');
const dealScheduler = require('./services/dealScheduler');
const telegramBotService = require('./services/telegramBotService');

let server;

initDb()
  .then(() => {
    server = app.listen(config.port, () => {
      logger.info(`Server running on http://localhost:${config.port} [${config.nodeEnv}]`);
    });

    dealScheduler.start();
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
  telegramBotService.stopPolling();
  if (server) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
});
