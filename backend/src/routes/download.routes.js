'use strict';

const express = require('express');

const validateUrl = require('../middleware/validateUrl');
const { resolve, download, save } = require('../controllers/download.controller');

const router = express.Router();

// Resolve a reel URL to its direct video URL (JSON response).
router.post('/resolve', validateUrl, resolve);

// Download the video file (streamed attachment). Supports GET ?url= and POST.
router.get('/download', validateUrl, download);
router.post('/download', validateUrl, download);

// Save the video to disk on the server and return the file path.
router.post('/save', validateUrl, save);

module.exports = router;
