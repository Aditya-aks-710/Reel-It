'use strict';

const express = require('express');
const downloadRoutes = require('./download.routes');

const router = express.Router();

router.use('/', downloadRoutes);

// API index so /api shows what's available.
router.get('/', (_req, res) => {
  res.json({
    name: 'reel-downloader API',
    endpoints: {
      'POST /api/resolve': 'Resolve a reel URL to its direct video URL',
      'GET  /api/download?url=...': 'Download the video file',
      'POST /api/download': 'Download the video file (url in body)',
    },
  });
});

module.exports = router;
