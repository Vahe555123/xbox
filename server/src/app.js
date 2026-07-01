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

// SEO: sitemap (nginx должен проксировать пути /sitemap*.xml и /robots.txt в Node).
const {
  getSitemapIndexXml,
  getStaticSitemapXml,
  getGamesSitemapXml,
  getRobotsTxt,
} = require('./services/sitemapService');

// /sitemap.xml — индекс (<sitemapindex>), перечисляет дочерние карты сайта.
// /sitemap-v2.xml — оставлен как алиас, чтобы обойти кэш ошибки в GSC (кэш
// привязан к URL) и для обратной совместимости со старыми ссылками.
app.get(['/sitemap.xml', '/sitemap-v2.xml'], async (_req, res, next) => {
  try {
    res.type('application/xml').send(await getSitemapIndexXml());
  } catch (err) {
    next(err);
  }
});
// /sitemap-static.xml — статические страницы.
app.get('/sitemap-static.xml', (_req, res) => {
  res.type('application/xml').send(getStaticSitemapXml());
});
// /sitemap-games-<N>.xml — куски каталога игр по 1000 URL (N начинается с 1).
app.get('/sitemap-games-:page.xml', async (req, res, next) => {
  try {
    const xml = await getGamesSitemapXml(req.params.page);
    if (!xml) return res.status(404).type('text/plain').send('Not found');
    return res.type('application/xml').send(xml);
  } catch (err) {
    return next(err);
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
