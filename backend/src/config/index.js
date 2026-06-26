'use strict';

// Load variables from backend/.env (resolved by absolute path so it works no
// matter which directory the server is started from).
require('dotenv').config({
  path: require('path').join(__dirname, '..', '..', '.env'),
});

/**
 * Central configuration.
 *
 * Reads from environment variables (loaded from .env via dotenv) and provides
 * sensible defaults so the app runs out of the box.
 */

const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  downloadDir: process.env.DOWNLOAD_DIR || 'downloads',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS) || 15000,

  // In-memory cache for resolved reels (avoids re-running extraction/yt-dlp).
  cacheTtlMs: Number(process.env.CACHE_TTL_MS) || 5 * 60 * 1000,

  // API rate limiting.
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 20,
  },

  // yt-dlp fallback: a robust extractor used when HTML scraping fails.
  ytdlp: {
    // Set YTDLP_ENABLED=0 to turn the fallback off.
    enabled: process.env.YTDLP_ENABLED !== '0',
    // Python interpreter that has yt-dlp installed. Defaults to the project
    // virtualenv on Windows, falling back to "python" on PATH.
    pythonPath: process.env.PYTHON_PATH || defaultPythonPath(),
    // Optional: reuse your logged-in browser cookies to beat the login wall.
    // e.g. COOKIES_FROM_BROWSER=chrome  (or firefox, edge, brave...)
    cookiesFromBrowser: process.env.COOKIES_FROM_BROWSER || null,
    // Optional: a Netscape-format cookies.txt file (avoids the locked-browser
    // cookie DB problem on Windows). Takes priority over cookiesFromBrowser.
    cookiesFile: process.env.COOKIES_FILE || null,
    // Optional: path to an ffmpeg binary/folder. Needed to convert audio to
    // mp3 and to merge higher-res video+audio. If ffmpeg is on PATH, leave null.
    ffmpegPath: process.env.FFMPEG_PATH || null,
    timeoutMs: Number(process.env.YTDLP_TIMEOUT_MS) || 45000,
  },
};

function defaultPythonPath() {
  const path = require('path');
  const venvPython =
    process.platform === 'win32'
      ? path.join(__dirname, '..', '..', '.venv', 'Scripts', 'python.exe')
      : path.join(__dirname, '..', '..', '.venv', 'bin', 'python');
  return venvPython;
}

module.exports = config;
