'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

/**
 * Limits how many API requests a single IP can make in a time window, so the
 * (relatively expensive) resolve/download endpoints can't be spammed.
 */
const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please slow down and try again shortly.',
  },
});

module.exports = apiRateLimiter;
