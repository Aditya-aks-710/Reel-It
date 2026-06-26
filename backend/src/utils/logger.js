'use strict';

/**
 * A tiny logger so the codebase doesn't depend on console.* everywhere.
 *
 * Practice idea: swap this for a real logger (pino / winston) without changing
 * any caller, since everyone imports this module instead of using console.
 */

function timestamp() {
  return new Date().toISOString();
}

const logger = {
  info(message, ...args) {
    console.log(`[${timestamp()}] [INFO ] ${message}`, ...args);
  },
  warn(message, ...args) {
    console.warn(`[${timestamp()}] [WARN ] ${message}`, ...args);
  },
  error(message, ...args) {
    console.error(`[${timestamp()}] [ERROR] ${message}`, ...args);
  },
};

module.exports = logger;
