const logger = require('../utils/logger');
const { AppError, formatErrorResponse } = require('../utils/errorFormatter');

function notFoundHandler(req, res, _next) {
  res.status(404).json({
    success: false,
    error: { message: `Route ${req.method} ${req.originalUrl} not found` },
  });
}

function globalErrorHandler(err, _req, res, _next) {
  const statusCode = err instanceof AppError ? err.statusCode : 500;

  logger.error(err.message, {
    stack: err.stack,
    statusCode,
  });

  res.status(statusCode).json(formatErrorResponse(err));
}

module.exports = { notFoundHandler, globalErrorHandler };
