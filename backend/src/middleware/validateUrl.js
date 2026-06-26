'use strict';

const AppError = require('../utils/AppError');

/**
 * Validate that the incoming request has a usable Instagram reel/post URL.
 *
 * Accepts the URL from either the JSON body ({ "url": "..." }) or a query
 * string (?url=...). On success it normalizes the value and attaches it as
 * req.reelUrl for downstream handlers.
 */

// Matches instagram.com/reel/<id>, /reels/<id>, /p/<id>, and share links.
const INSTAGRAM_URL_REGEX =
  /^https?:\/\/(www\.)?instagram\.com\/(reel|reels|p|tv)\/[A-Za-z0-9_-]+\/?/i;

function validateUrl(req, _res, next) {
  const raw = (req.body && req.body.url) || req.query.url;

  if (!raw || typeof raw !== 'string') {
    return next(new AppError('Missing "url". Provide an Instagram reel link.', 400));
  }

  const url = raw.trim();

  if (!INSTAGRAM_URL_REGEX.test(url)) {
    return next(
      new AppError(
        'That does not look like a valid Instagram reel/post URL.',
        400
      )
    );
  }

  req.reelUrl = url;
  next();
}

module.exports = validateUrl;
module.exports.INSTAGRAM_URL_REGEX = INSTAGRAM_URL_REGEX;
