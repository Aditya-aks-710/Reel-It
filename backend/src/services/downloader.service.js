'use strict';

const config = require('../config');
const AppError = require('../utils/AppError');

/**
 * downloader.service.js
 * ---------------------
 * Given a direct video URL, fetch the bytes. We expose the response as a
 * readable stream so the controller can pipe it straight to the client without
 * buffering the whole file in memory.
 */

/**
 * Open a streaming download for a direct video URL.
 * @param {string} videoUrl
 * @returns {Promise<{ stream: ReadableStream, contentType: string, contentLength: string|null }>}
 */
async function openVideoStream(videoUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const res = await fetch(videoUrl, {
      headers: { 'User-Agent': config.userAgent },
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      throw new AppError(`Failed to download video (status ${res.status}).`, 502);
    }

    return {
      stream: res.body,
      contentType: res.headers.get('content-type') || 'video/mp4',
      contentLength: res.headers.get('content-length'),
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AppError('Timed out downloading the video.', 504);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Build a friendly filename like "reel-1718csk.mp4". */
function buildFilename(reelUrl) {
  const match = reelUrl.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  const id = match ? match[2] : Date.now().toString();
  return `reel-${id}.mp4`;
}

module.exports = { openVideoStream, buildFilename };
