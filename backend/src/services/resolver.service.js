'use strict';

const config = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const ytdlp = require('./ytdlp.service');
const cache = require('./cache.service');

/**
 * resolver.service.js
 * -------------------
 * Turns an Instagram reel URL into a direct video file URL.
 *
 * Instagram has no public download API, so the common approach is to fetch the
 * reel's public HTML page and read the Open Graph meta tag `og:video`, which
 * points at the .mp4. This works for PUBLIC reels.
 *
 * NOTE: Instagram changes its markup often and may block scraping. Treat this as
 * a learning exercise, respect Instagram's Terms of Service, and only download
 * content you have the right to.
 */

/**
 * Warm a logged-out "guest" session.
 *
 * Instagram only embeds the playable video data in the reel page when the
 * request carries a guest session cookie (csrftoken/mid) AND browser-like
 * headers — exactly what a logged-out browser sends when it plays the reel
 * behind the signup modal. We fetch the homepage once and reuse its cookies.
 */
let _guestCookie = null;
let _guestCookieAt = 0;
const GUEST_COOKIE_TTL_MS = 10 * 60 * 1000;

async function getGuestCookie() {
  const now = Date.now();
  if (_guestCookie !== null && now - _guestCookieAt < GUEST_COOKIE_TTL_MS) {
    return _guestCookie;
  }
  try {
    const res = await fetch('https://www.instagram.com/', {
      headers: {
        'User-Agent': config.userAgent,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const jar = {};
    for (const line of res.headers.getSetCookie() || []) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
    _guestCookie = Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    _guestCookieAt = now;
  } catch (err) {
    logger.warn(`Could not warm guest session: ${err.message}`);
    _guestCookie = _guestCookie || '';
  }
  return _guestCookie;
}

/**
 * Fetch the raw HTML of a reel page.
 * @param {string} url
 * @returns {Promise<string>} HTML body
 */
async function fetchReelPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const cookie = await getGuestCookie();
    const res = await fetch(url, {
      headers: {
        'User-Agent': config.userAgent,
        'Accept-Language': 'en-US,en;q=0.9',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,' +
          'image/avif,image/webp,*/*;q=0.8',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'upgrade-insecure-requests': '1',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new AppError(
        `Instagram responded with status ${res.status}`,
        res.status === 404 ? 404 : 502
      );
    }

    return await res.text();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AppError('Timed out fetching the reel page.', 504);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Build Instagram's public embed URL for a reel/post.
 * The embed page is served WITHOUT a login wall, so it often exposes the
 * video URL even when the normal page does not.
 * @param {string} reelUrl
 * @returns {string|null}
 */
function toEmbedUrl(reelUrl) {
  const match = reelUrl.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  if (!match) return null;
  return `https://www.instagram.com/p/${match[2]}/embed/captioned/`;
}

/**
 * Extract the direct video URL from page HTML.
 *
 * Strategy 1 (implemented): read the og:video meta tag.
 *
 * @param {string} html
 * @returns {string|null} direct .mp4 URL, or null if not found
 */
function extractVideoUrl(html) {
  // Preferred: the "video_versions" array Instagram embeds in the page JSON for
  // logged-out viewers. These are PROGRESSIVE mp4s that already include audio
  // (this is the stream the browser plays behind the signup modal).
  const versions = html.match(/"video_versions":\[(.*?)\]/s);
  if (versions && versions[1]) {
    const urls = [...versions[1].matchAll(/"url":"([^"]+)"/g)].map((m) =>
      unescapeJsonString(m[1])
    );
    const mp4 = urls.find((u) => /\.mp4/i.test(u)) || urls[0];
    if (mp4) return mp4;
  }

  // <meta property="og:video" content="https://...mp4" />
  const ogVideo = html.match(
    /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i
  );
  if (ogVideo && ogVideo[1]) {
    return decodeHtmlEntities(ogVideo[1]);
  }

  // Exercise 1: fallback to the JSON blob Instagram embeds in a <script> tag.
  // The direct .mp4 appears as "video_url":"https:\/\/..." where forward
  // slashes (and other characters) are JSON-escaped, so we un-escape them.
  const jsonVideo = html.match(/"video_url":"(https:\\?\/\\?\/[^"]+)"/i);
  if (jsonVideo && jsonVideo[1]) {
    return unescapeJsonString(jsonVideo[1]);
  }

  return null;
}

/** Un-escape a JSON string fragment: \/ -> /, \u0026 -> &, \\ -> \, etc. */
function unescapeJsonString(str) {
  try {
    // Let JSON.parse handle all standard escape sequences (\/, \uXXXX, \\, ...).
    return JSON.parse(`"${str}"`);
  } catch {
    // Fallback if the fragment isn't valid on its own.
    return str.replace(/\\\//g, '/').replace(/\\u0026/gi, '&');
  }
}

/** Convert &amp; &quot; etc. back to normal characters. */
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Exercise 2: pull preview metadata (thumbnail, caption, username) from HTML.
 * Each field is optional — returns null for anything it can't find.
 * @param {string} html
 * @returns {{ thumbnail: string|null, caption: string|null, username: string|null }}
 */
function extractMetadata(html) {
  // og:image -> thumbnail
  const ogImage = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
  );

  // og:title / og:description -> caption text
  const ogTitle = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i
  );
  const ogDescription = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i
  );

  // Username often appears as "username":"..." in the embedded JSON, or inside
  // the og:title like: 'Some Caption \u2022 Instagram (@theuser)'.
  let username = null;
  const jsonUser = html.match(/"username":"([A-Za-z0-9._]+)"/i);
  if (jsonUser) {
    username = jsonUser[1];
  } else if (ogTitle && ogTitle[1]) {
    const atUser = ogTitle[1].match(/\(@([A-Za-z0-9._]+)\)/);
    if (atUser) username = atUser[1];
  }

  const caption = ogTitle && ogTitle[1]
    ? decodeHtmlEntities(ogTitle[1])
    : ogDescription && ogDescription[1]
      ? decodeHtmlEntities(ogDescription[1])
      : null;

  return {
    thumbnail: ogImage && ogImage[1] ? decodeHtmlEntities(ogImage[1]) : null,
    caption,
    username,
  };
}

/**
 * Public entry point: resolve a reel URL to downloadable video metadata.
 * @param {string} reelUrl
 * @returns {Promise<{ videoUrl: string, sourceUrl: string }>}
 */
async function resolveReel(reelUrl) {
  logger.info(`Resolving reel: ${reelUrl}`);

  // Serve from cache if we resolved this reel recently.
  const cached = cache.get(reelUrl);
  if (cached) {
    logger.info('Cache hit — reusing resolved reel.');
    return cached;
  }

  // Try the normal page first.
  let html = await fetchReelPage(reelUrl);
  let videoUrl = extractVideoUrl(html);

  // If logged-out Instagram hid the video (login wall), retry the public
  // embed endpoint, which usually still exposes it.
  if (!videoUrl) {
    const embedUrl = toEmbedUrl(reelUrl);
    if (embedUrl) {
      logger.info(`No video on main page, trying embed: ${embedUrl}`);
      try {
        const embedHtml = await fetchReelPage(embedUrl);
        const embedVideo = extractVideoUrl(embedHtml);
        if (embedVideo) {
          videoUrl = embedVideo;
          html = embedHtml;
        }
      } catch (err) {
        logger.warn(`Embed fallback failed: ${err.message}`);
      }
    }
  }

  // Final fallback: yt-dlp, which handles the login wall far better and can
  // reuse browser cookies. It returns the video URL AND preview metadata.
  if (!videoUrl && ytdlp.isAvailable()) {
    try {
      const result = await ytdlp.resolveWithYtDlp(reelUrl);
      logger.info('Resolved via yt-dlp fallback.');
      const payload = { ...result, sourceUrl: reelUrl };
      cache.set(reelUrl, payload);
      return payload;
    } catch (err) {
      logger.warn(`yt-dlp fallback failed: ${err.message}`);
    }
  }

  if (!videoUrl) {
    throw new AppError(
      'Could not find a video in that reel. It may be private, or Instagram ' +
        'is showing a login wall to logged-out requests.',
      422
    );
  }

  // Exercise 2: attach preview metadata so the UI can show it before download.
  const metadata = extractMetadata(html);

  const payload = { videoUrl, sourceUrl: reelUrl, ...metadata };
  cache.set(reelUrl, payload);
  return payload;
}

module.exports = {
  resolveReel,
  // Exported for unit testing:
  extractVideoUrl,
  decodeHtmlEntities,
  unescapeJsonString,
  extractMetadata,
  toEmbedUrl,
};
