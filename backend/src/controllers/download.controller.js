'use strict';

const { resolveReel } = require('../services/resolver.service');
const {
  openVideoStream,
  openAudioStream,
  openMuxedStream,
  buildFilename,
} = require('../services/downloader.service');
const { ffmpegAvailable } = require('../services/ytdlp.service');
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
 *   ?audio=1    download just the audio track instead of the full video
 */
const download = asyncHandler(async (req, res) => {
  const filename = buildFilename(req.reelUrl);
  const isInline = !!req.query.inline;
  const disposition = isInline ? 'inline' : 'attachment';
  const audioOnly = req.query.audio === '1' || req.query.audio === 'true';

  // The resolver returns Instagram's progressive mp4 (video + AAC audio) via
  // the no-login guest-session method. When it falls back to yt-dlp, the reel
  // may instead come as a separate video-only + audio-only pair (audioUrl set).
  const { videoUrl, audioUrl } = await resolveReel(req.reelUrl);

  // Audio-only: copy just the audio track into a streamed m4a with ffmpeg.
  // Prefer the dedicated audio track when we have one, else strip it from the
  // progressive video.
  if (audioOnly && (await ffmpegAvailable())) {
    const outName = filename.replace(/\.mp4$/i, '.m4a');
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Content-Disposition', `${disposition}; filename="${outName}"`);
    const { stream } = openAudioStream(audioUrl || videoUrl);
    stream.pipe(res);
    return;
  }

  // Separate DASH tracks: mux the video-only and audio-only streams together so
  // the download isn't silent. Needs ffmpeg (always present in Docker/Render).
  if (audioUrl && (await ffmpegAvailable())) {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    const { stream } = openMuxedStream(videoUrl, audioUrl);
    stream.pipe(res);
    return;
  }

  // Video (or audio fallback when ffmpeg isn't installed): stream the resolved
  // progressive mp4 directly — it already includes audio.
  const { stream, contentType, contentLength } = await openVideoStream(videoUrl);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
  if (contentLength) res.setHeader('Content-Length', contentLength);

  // Convert the WHATWG ReadableStream from fetch() into a Node stream and pipe.
  Readable.fromWeb(stream).pipe(res);
});

module.exports = { resolve, download };
