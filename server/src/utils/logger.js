const config = require('../config');

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = config.nodeEnv === 'production' ? LOG_LEVELS.info : LOG_LEVELS.debug;

function fmt(level, msg, meta) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  return meta !== undefined ? `${base} ${JSON.stringify(meta)}` : base;
}

const logger = {
  error: (msg, meta) => LOG_LEVELS.error <= currentLevel && console.error(fmt('error', msg, meta)),
  warn: (msg, meta) => LOG_LEVELS.warn <= currentLevel && console.warn(fmt('warn', msg, meta)),
  info: (msg, meta) => LOG_LEVELS.info <= currentLevel && console.log(fmt('info', msg, meta)),
  debug: (msg, meta) => LOG_LEVELS.debug <= currentLevel && console.log(fmt('debug', msg, meta)),
};

module.exports = logger;
