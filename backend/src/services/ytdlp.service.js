'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * ytdlp.service.js
 * ----------------
 * A robust fallback that shells out to yt-dlp (a maintained downloader that
 * understands Instagram's markup and can reuse browser cookies). We ask it for
 * metadata as JSON (`-J`) and read the direct video URL + preview fields.
 *
 * This is used only when the lightweight HTML scraping in resolver.service.js
 * comes up empty (e.g. Instagram serves a login wall).
 */

/** Is the configured Python interpreter actually present? */
function isAvailable() {
  if (!config.ytdlp.enabled) return false;
  const p = config.ytdlp.pythonPath;
  // "python" on PATH won't be an absolute file; assume it exists in that case.
  if (!p.includes('/') && !p.includes('\\')) return true;
  return fs.existsSync(p);
}

/**
 * Build the ordered list of cookie strategies to try. We attempt the most
 * capable option first and fall back to anonymous, so a locked browser cookie
 * DB (a common Windows issue) doesn't block extraction entirely.
 * @returns {Array<{ label: string, args: string[] }>}
 */
function cookieStrategies() {
  const strategies = [];
  if (config.ytdlp.cookiesFile && fs.existsSync(config.ytdlp.cookiesFile)) {
    strategies.push({
      label: `cookies file (${config.ytdlp.cookiesFile})`,
      args: ['--cookies', config.ytdlp.cookiesFile],
    });
  }
  if (config.ytdlp.cookiesFromBrowser) {
    strategies.push({
      label: `browser cookies (${config.ytdlp.cookiesFromBrowser})`,
      args: ['--cookies-from-browser', config.ytdlp.cookiesFromBrowser],
    });
  }
  // Always end with an anonymous attempt so a cookie problem can't block us.
  strategies.push({ label: 'no cookies', args: [] });
  return strategies;
}

/**
 * Lazily detect whether ffmpeg is available (needed to transcode audio to mp3
 * and to merge higher-resolution DASH video+audio). The result is cached.
 * @returns {Promise<boolean>}
 */
let _ffmpegPromise = null;
function ffmpegAvailable() {
  if (!_ffmpegPromise) {
    _ffmpegPromise = new Promise((resolve) => {
      const bin = config.ytdlp.ffmpegPath || 'ffmpeg';
      const child = spawn(bin, ['-version'], { windowsHide: true });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
  }
  return _ffmpegPromise;
}

/**
 * Spawn yt-dlp with the given args and resolve with its stdout.
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ytdlp.pythonPath, ['-m', 'yt_dlp', ...args], {
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new AppError('yt-dlp timed out.', 504));
    }, config.ytdlp.timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new AppError(`Could not run yt-dlp: ${err.message}`, 500));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const reason = stderr.trim().split('\n').pop() || `exit code ${code}`;
        return reject(new AppError(`yt-dlp failed: ${reason}`, 502));
      }
      resolve(stdout);
    });
  });
}

/**
 * Run yt-dlp across each cookie strategy until one succeeds.
 * @param {string[]} baseArgs  args excluding cookie flags and the URL
 * @param {string} reelUrl
 * @returns {Promise<string>} stdout of the successful run
 */
async function runWithCookieFallback(baseArgs, reelUrl) {
  let lastErr;
  for (const strategy of cookieStrategies()) {
    try {
      logger.info(`yt-dlp attempt using ${strategy.label}`);
      return await runYtDlp([...baseArgs, ...strategy.args, reelUrl]);
    } catch (err) {
      lastErr = err;
      logger.warn(`yt-dlp (${strategy.label}) failed: ${err.message}`);
    }
  }
  throw lastErr || new AppError('yt-dlp failed.', 502);
}

/**
 * Choose the best streams from yt-dlp's info.
 *
 * Instagram reels often expose only SEPARATE DASH tracks (a video-only stream
 * plus an audio-only stream). yt-dlp's top-level `info.url` is then the
 * video-only track — which is exactly why a naive pick comes out silent. So we:
 *   1. prefer a single progressive format that already carries audio, else
 *   2. return the best video-only + best audio-only pair (muxed later), else
 *   3. fall back to whatever single URL is available.
 *
 * @returns {{ videoUrl: string, audioUrl: string|null } | null}
 */
function pickStreams(info) {
  const formats = (Array.isArray(info.formats) ? info.formats : []).filter(
    (f) => f.url
  );

  const hasVideo = (f) => f.vcodec && f.vcodec !== 'none';
  const hasAudio = (f) => f.acodec && f.acodec !== 'none';

  // 1) Progressive: one file with both video and audio.
  const progressive = formats
    .filter((f) => hasVideo(f) && hasAudio(f))
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  if (progressive.length) {
    return { videoUrl: progressive[0].url, audioUrl: null };
  }

  // 2) Separate DASH tracks: best video-only + best audio-only, muxed later.
  const videoOnly = formats
    .filter((f) => hasVideo(f) && !hasAudio(f))
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  const audioOnly = formats
    .filter((f) => hasAudio(f) && !hasVideo(f))
    .sort((a, b) => (b.abr || 0) - (a.abr || 0));
  if (videoOnly.length && audioOnly.length) {
    return { videoUrl: videoOnly[0].url, audioUrl: audioOnly[0].url };
  }

  // 3) Last resort: any single URL (may be silent if it's a video-only track).
  if (videoOnly.length) return { videoUrl: videoOnly[0].url, audioUrl: null };
  if (info.url) return { videoUrl: info.url, audioUrl: null };
  if (formats.length) {
    formats.sort((a, b) => (b.height || 0) - (a.height || 0));
    return { videoUrl: formats[0].url, audioUrl: null };
  }
  return null;
}

/**
 * Resolve a reel via yt-dlp.
 * @param {string} reelUrl
 * @returns {Promise<{ videoUrl: string, audioUrl: string|null, thumbnail: string|null, caption: string|null, username: string|null }>}
 */
async function resolveWithYtDlp(reelUrl) {
  logger.info(`Trying yt-dlp fallback for: ${reelUrl}`);
  const stdout = await runWithCookieFallback(
    ['-J', '--no-warnings', '--no-playlist'],
    reelUrl
  );

  let info;
  try {
    info = JSON.parse(stdout);
  } catch {
    throw new AppError('Could not parse yt-dlp output.', 502);
  }

  const streams = pickStreams(info);
  if (!streams) {
    throw new AppError('yt-dlp could not find a downloadable video.', 422);
  }

  return {
    videoUrl: streams.videoUrl,
    audioUrl: streams.audioUrl,
    thumbnail: info.thumbnail || null,
    caption: info.description || info.title || null,
    username: info.uploader || info.uploader_id || null,
  };
}

module.exports = {
  isAvailable,
  resolveWithYtDlp,
  ffmpegAvailable,
};
