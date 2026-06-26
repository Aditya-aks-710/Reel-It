'use strict';

const path = require('path');
const express = require('express');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const apiRateLimiter = require('./middleware/rateLimit');
const logger = require('./utils/logger');

/**
 * Build and configure the Express application.
 * Kept separate from server.js so it can be imported in tests without
 * actually starting an HTTP listener.
 */
function createApp() {
  const app = express();

  // Parse JSON and form bodies.
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Simple request logging.
  app.use((req, _res, next) => {
    logger.info(`${req.method} ${req.url}`);
    next();
  });

  // Serve the built React frontend (frontend/dist) when it exists. In dev the
  // frontend runs on Vite (port 5173) and proxies /api here instead.
  const clientDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  app.use(express.static(clientDist));

  // API routes (rate-limited).
  app.use('/api', apiRateLimiter, routes);

  // Health check.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // 404 for anything unmatched.
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found', path: req.url });
  });

  // Central error handler (must be last).
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
