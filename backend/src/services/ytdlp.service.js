'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
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

/** Pick the best direct, progressive (video+audio) MP4 URL from yt-dlp info. */
function pickVideoUrl(info) {
  if (info.url) return info.url;

  const formats = Array.isArray(info.formats) ? info.formats : [];
  const progressive = formats.filter(
    (f) =>
      f.url &&
      f.vcodec &&
      f.vcodec !== 'none' &&
      f.acodec &&
      f.acodec !== 'none'
  );
  const pool = progressive.length ? progressive : formats.filter((f) => f.url);
  if (!pool.length) return null;

  pool.sort((a, b) => (b.height || 0) - (a.height || 0));
  return pool[0].url;
}

/**
 * Resolve a reel via yt-dlp.
 * @param {string} reelUrl
 * @returns {Promise<{ videoUrl: string, thumbnail: string|null, caption: string|null, username: string|null }>}
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

  const videoUrl = pickVideoUrl(info);
  if (!videoUrl) {
    throw new AppError('yt-dlp could not find a downloadable video.', 422);
  }

  return {
    videoUrl,
    thumbnail: info.thumbnail || null,
    caption: info.description || info.title || null,
    username: info.uploader || info.uploader_id || null,
  };
}

/**
 * Let yt-dlp download the reel directly to disk.
 * @param {string} reelUrl
 * @param {string} outDir   directory to save into
 * @param {{ audioOnly?: boolean }} [opts]
 *   audioOnly: grab just the audio track (m4a) instead of the full video.
 * @returns {Promise<{ filePath: string }>}
 */
async function downloadToFile(reelUrl, outDir, opts = {}) {
  const audioOnly = !!opts.audioOnly;
  const outTemplate = path.join(outDir, 'reel-%(id)s.%(ext)s');

  const args = ['--no-warnings', '--no-playlist'];
  if (audioOnly) {
    // Best audio stream as-is (m4a) — no re-encode, so no ffmpeg required.
    args.push('-f', 'bestaudio[ext=m4a]/bestaudio/ba/best');
    // If ffmpeg is available, transcode to mp3 for maximum compatibility.
    if (await ffmpegAvailable()) {
      args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
    }
  } else {
    // Best video+audio: merges with ffmpeg if available, otherwise falls
    // through to the best single (progressive) stream automatically.
    args.push('-f', 'bv*+ba/b/best', '--merge-output-format', 'mp4');
  }
  if (config.ytdlp.ffmpegPath) {
    args.push('--ffmpeg-location', config.ytdlp.ffmpegPath);
  }
  args.push('-o', outTemplate, '--print', 'after_move:filepath');

  const stdout = await runWithCookieFallback(args, reelUrl);

  // Prefer the explicit path yt-dlp printed, but fall back to scanning the
  // output directory (merge/extract can change the extension, and extra stdout
  // lines can shift the last line).
  const printed = stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
  if (printed && fs.existsSync(printed)) {
    return { filePath: printed };
  }

  const produced = (await fs.promises.readdir(outDir))
    .filter((f) => /^reel-.*\.(mp4|mkv|webm|mov|m4a|mp3|aac|opus|ogg)$/i.test(f))
    .map((f) => path.join(outDir, f));
  if (produced.length) {
    // Newest file wins.
    produced.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return { filePath: produced[0] };
  }

  throw new AppError('yt-dlp did not produce a downloadable file.', 502);
}

module.exports = {
  isAvailable,
  resolveWithYtDlp,
  pickVideoUrl,
  downloadToFile,
};
