'use strict';

const { spawn } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
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
 * Extract just the audio track from a progressive video URL using ffmpeg and
 * stream it back as m4a. Instagram's progressive mp4 already carries AAC audio,
 * so we copy it (no re-encode) into a fragmented mp4 that streams without
 * needing to seek. Requires ffmpeg to be available.
 * @param {string} videoUrl
 * @returns {{ stream: NodeJS.ReadableStream, contentType: string }}
 */
function openAudioStream(videoUrl) {
  const bin = config.ytdlp.ffmpegPath || 'ffmpeg';
  const child = spawn(
    bin,
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-user_agent', config.userAgent,
      '-i', videoUrl,
      '-vn',
      '-c:a', 'copy',
      '-movflags', 'frag_keyframe+empty_moov',
      '-f', 'mp4',
      'pipe:1',
    ],
    { windowsHide: true }
  );

  child.stderr.on('data', (d) => logger.warn(`ffmpeg: ${String(d).trim()}`));
  child.on('error', (err) => {
    logger.error(`ffmpeg could not run: ${err.message}`);
    child.stdout.destroy(err);
  });

  return { stream: child.stdout, contentType: 'audio/mp4' };
}

/**
 * Mux a separate video-only track and audio-only track into a single mp4 and
 * stream it back. Instagram sometimes serves reels as separate DASH streams, so
 * the "video" URL alone has no sound; ffmpeg copies both tracks (no re-encode)
 * into a fragmented mp4 that streams without seeking. Requires ffmpeg.
 * @param {string} videoUrl  video-only stream
 * @param {string} audioUrl  audio-only stream
 * @returns {{ stream: NodeJS.ReadableStream, contentType: string }}
 */
function openMuxedStream(videoUrl, audioUrl) {
  const bin = config.ytdlp.ffmpegPath || 'ffmpeg';
  const child = spawn(
    bin,
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-user_agent', config.userAgent,
      '-i', videoUrl,
      '-user_agent', config.userAgent,
      '-i', audioUrl,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c', 'copy',
      '-movflags', 'frag_keyframe+empty_moov',
      '-f', 'mp4',
      'pipe:1',
    ],
    { windowsHide: true }
  );

  child.stderr.on('data', (d) => logger.warn(`ffmpeg: ${String(d).trim()}`));
  child.on('error', (err) => {
    logger.error(`ffmpeg could not run: ${err.message}`);
    child.stdout.destroy(err);
  });

  return { stream: child.stdout, contentType: 'video/mp4' };
}

/** Build a friendly filename like "reel-1718csk.mp4". */
function buildFilename(reelUrl) {
  const match = reelUrl.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  const id = match ? match[2] : Date.now().toString();
  return `reel-${id}.mp4`;
}

module.exports = { openVideoStream, openAudioStream, openMuxedStream, buildFilename };
