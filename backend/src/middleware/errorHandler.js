'use strict';

const logger = require('../utils/logger');

/**
 * Central Express error handler.
 * Any error passed to next(err) or thrown in an async handler (when wrapped)
 * ends up here. Returns a clean JSON shape and hides stack traces in prod.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || 500;

  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.url} -> ${err.message}`, err.stack);
  } else {
    logger.warn(`${req.method} ${req.url} -> ${err.message}`);
  }

  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && statusCode >= 500
      ? { stack: err.stack }
      : {}),
  });
}

module.exports = errorHandler;
