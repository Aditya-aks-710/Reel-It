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

/** Map a file extension to a sensible Content-Type for media downloads. */
function contentTypeFor(ext) {
  switch (ext.toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
    case '.aac':
      return 'audio/mp4';
    case '.opus':
    case '.ogg':
      return 'audio/ogg';
    case '.webm':
      return 'video/webm';
    case '.mkv':
      return 'video/x-matroska';
    case '.mov':
      return 'video/quicktime';
    default:
      return 'video/mp4';
  }
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
 *   ?audio=1    download just the audio track instead of the full video
 */
const download = asyncHandler(async (req, res) => {
  const filename = buildFilename(req.reelUrl);
  const isInline = !!req.query.inline;
  const disposition = isInline ? 'inline' : 'attachment';
  const audioOnly = req.query.audio === '1' || req.query.audio === 'true';

  // Audio-only: let yt-dlp extract just the audio track (m4a, or mp3 if ffmpeg
  // is present). The video path below doesn't need yt-dlp.
  if (audioOnly && ytdlp.isAvailable()) {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reel-'));
    try {
      const { filePath } = await ytdlp.downloadToFile(req.reelUrl, tmpDir, {
        audioOnly: true,
      });
      const { size } = await fs.promises.stat(filePath);
      const ext = path.extname(filePath) || '.m4a';
      const outName = filename.replace(/\.mp4$/i, ext);
      res.setHeader('Content-Type', contentTypeFor(ext));
      res.setHeader('Content-Disposition', `${disposition}; filename="${outName}"`);
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

  // Video (download or inline preview): stream the resolved URL directly.
  // Instagram's "video_versions" are PROGRESSIVE mp4s that already include
  // audio, so the file has sound without needing an ffmpeg merge.
  const { videoUrl } = await resolveReel(req.reelUrl);
  const { stream, contentType, contentLength } = await openVideoStream(videoUrl);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
  if (contentLength) res.setHeader('Content-Length', contentLength);

  // Convert the WHATWG ReadableStream from fetch() into a Node stream and pipe.
  Readable.fromWeb(stream).pipe(res);
});

module.exports = { resolve, download };
