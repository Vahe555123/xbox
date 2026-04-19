const { AppError } = require('../utils/errorFormatter');

function validateSearch(req, _res, next) {
  const { q, encodedCT } = req.query;

  if (q !== undefined && typeof q !== 'string') {
    return next(new AppError('Query parameter "q" must be a string', 400));
  }

  if (q && q.length > 200) {
    return next(new AppError('Query parameter "q" must be at most 200 characters', 400));
  }

  if (encodedCT !== undefined && typeof encodedCT !== 'string') {
    return next(new AppError('Parameter "encodedCT" must be a string', 400));
  }

  next();
}

module.exports = { validateSearch };
