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

  // For real downloads (and all audio), let yt-dlp produce the file. It always
  // yields a stream WITH audio: it merges the separate video/audio tracks when
  // ffmpeg is present, or falls back to a progressive (audio-included) stream
  // when it isn't. Instagram often serves video-only adaptive streams, so
  // piping the raw resolved URL can give a silent file.
  if (ytdlp.isAvailable() && (audioOnly || !isInline)) {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reel-'));
    try {
      const { filePath } = await ytdlp.downloadToFile(req.reelUrl, tmpDir, {
        audioOnly,
      });
      const { size } = await fs.promises.stat(filePath);
      const ext = path.extname(filePath) || (audioOnly ? '.m4a' : '.mp4');
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

  // Inline preview (or yt-dlp unavailable): stream the resolved URL directly
  // for an instant preview.
  const { videoUrl } = await resolveReel(req.reelUrl);
  const { stream, contentType, contentLength } = await openVideoStream(videoUrl);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
  if (contentLength) res.setHeader('Content-Length', contentLength);

  // Convert the WHATWG ReadableStream from fetch() into a Node stream and pipe.
  Readable.fromWeb(stream).pipe(res);
});

module.exports = { resolve, download };
