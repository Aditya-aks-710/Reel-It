'use strict';

const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`Reel downloader running at http://localhost:${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);
});

// Graceful shutdown.
function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down...`);
  server.close(() => {
    logger.info('Server closed. Bye!');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
