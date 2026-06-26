'use strict';

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
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

/**
 * Exercise 3: download a video and save it to disk under config.downloadDir.
 * Streams the bytes straight to a file (no full-buffer in memory).
 * @param {string} videoUrl
 * @param {string} filename
 * @returns {Promise<{ filePath: string, bytes: number }>}
 */
async function saveToDisk(videoUrl, filename) {
  const dir = path.resolve(config.downloadDir);
  await fs.promises.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, filename);
  const { stream } = await openVideoStream(videoUrl);

  // Convert the WHATWG ReadableStream from fetch() into a Node stream, then
  // pipe it into a write stream. pipeline() handles errors + cleanup for us.
  await pipeline(Readable.fromWeb(stream), fs.createWriteStream(filePath));

  const { size } = await fs.promises.stat(filePath);
  return { filePath, bytes: size };
}

/** Build a friendly filename like "reel-1718csk.mp4". */
function buildFilename(reelUrl) {
  const match = reelUrl.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  const id = match ? match[2] : Date.now().toString();
  return `reel-${id}.mp4`;
}

module.exports = { openVideoStream, saveToDisk, buildFilename };
