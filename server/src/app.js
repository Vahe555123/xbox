const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const routes = require('./routes');
const requestLogger = require('./middleware/requestLogger');
const ogMiddleware = require('./middleware/ogMiddleware');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
const corsOrigins = config.clientOrigin.split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins, credentials: true }));
app.use(express.json());
app.use(requestLogger);

// Перехватываем запросы от Telegram/VK/Max-ботов — отдаём HTML с OG-тегами.
// nginx проксирует сюда только запросы с User-Agent социальных ботов.
app.use(ogMiddleware);

// SEO: sitemap.xml и robots.txt (nginx должен проксировать эти пути в Node).
const { getSitemapXml, getRobotsTxt } = require('./services/sitemapService');
app.get('/sitemap.xml', async (_req, res, next) => {
  try {
    res.type('application/xml').send(await getSitemapXml());
  } catch (err) {
    next(err);
  }
});
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(getRobotsTxt());
});

app.use(
  '/api',
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { message: 'Too many requests — please slow down' } },
  }),
);

app.use('/api', routes);
app.use('/', routes);

app.use(notFoundHandler);
app.use(globalErrorHandler);

module.exports = app;
