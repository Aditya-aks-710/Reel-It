'use strict';

const config = require('../config');

/**
 * cache.service.js
 * ----------------
 * A tiny in-memory TTL cache. Used to remember resolved reels for a few minutes
 * so we don't re-run extraction (and yt-dlp) on every download request.
 *
 * Note: this lives in process memory, so it resets on restart and isn't shared
 * across multiple server instances. Swap for Redis if you need that later.
 */

const store = new Map(); // key -> { value, expiresAt }

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlMs = config.cacheTtlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function clear() {
  store.clear();
}

module.exports = { get, set, clear };
