'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveReel } = require('../services/resolver.service');
const {
  openVideoStream,
  buildFilename,
} = require('../services/downloader.service');
const ytdlp = require('../services/ytdlp.service');
const { Readable } = require('stream');

/**
 * Small wrapper so async errors are forwarded to Express' error handler.
 * (Express 4 doesn't catch rejected promises automatically.)
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * POST /api/resolve
 * Body: { "url": "https://www.instagram.com/reel/XXXX/" }
 * Returns JSON with the direct video URL (does NOT download).
 */
const resolve = asyncHandler(async (req, res) => {
  const result = await resolveReel(req.reelUrl);
  res.json({ success: true, ...result });
});

/**
 * GET /api/download?url=...   (or POST with { url })
 * Streams the actual media file back.
 *   ?inline=1   play in a <video> element instead of forcing a download
 *   ?audio=1    download just the audio track (m4a) instead of the full video
 */
const download = asyncHandler(async (req, res) => {
  const filename = buildFilename(req.reelUrl);
  const disposition = req.query.inline ? 'inline' : 'attachment';
  const audioOnly = req.query.audio === '1' || req.query.audio === 'true';

  // Audio only: let yt-dlp pull the best audio stream to a temp file, stream
  // it back, then clean up.
  if (audioOnly && ytdlp.isAvailable()) {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reel-'));
    try {
      const { filePath } = await ytdlp.downloadToFile(req.reelUrl, tmpDir, {
        audioOnly: true,
      });
      const { size } = await fs.promises.stat(filePath);
      const ext = path.extname(filePath) || '.m4a';
      const audioName = filename.replace(/\.mp4$/i, ext);
      res.setHeader('Content-Type', ext === '.mp3' ? 'audio/mpeg' : 'audio/mp4');
      res.setHeader('Content-Disposition', `${disposition}; filename="${audioName}"`);
      res.setHeader('Content-Length', size);
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(filePath);
        rs.on('error', reject);
        rs.on('end', resolve);
        rs.pipe(res);
      });
    } finally {
      fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    return;
  }

  // Video (with audio): stream the base progressive URL straight through (fast).
  const { videoUrl } = await resolveReel(req.reelUrl);
  const { stream, contentType, contentLength } = await openVideoStream(videoUrl);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
  if (contentLength) res.setHeader('Content-Length', contentLength);

  // Convert the WHATWG ReadableStream from fetch() into a Node stream and pipe.
  Readable.fromWeb(stream).pipe(res);
});

module.exports = { resolve, download };
