'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  extractVideoUrl,
  decodeHtmlEntities,
  unescapeJsonString,
  extractMetadata,
  toEmbedUrl,
} = require('../src/services/resolver.service');
const { INSTAGRAM_URL_REGEX } = require('../src/middleware/validateUrl');

test('extractVideoUrl finds og:video meta tag', () => {
  const html = `
    <html><head>
      <meta property="og:video" content="https://cdn.example.com/video.mp4?token=abc&amp;sig=1" />
    </head></html>`;
  const url = extractVideoUrl(html);
  assert.strictEqual(url, 'https://cdn.example.com/video.mp4?token=abc&sig=1');
});

test('extractVideoUrl returns null when no video present', () => {
  const html = '<html><head><title>no video here</title></head></html>';
  assert.strictEqual(extractVideoUrl(html), null);
});

test('extractVideoUrl prefers progressive video_versions over og:video', () => {
  const html = `
    <html><head>
      <meta property="og:video" content="https://cdn.example.com/dash.mp4" />
    </head><body><script type="application/json">
      {"video_versions":[{"type":101,"url":"https:\\/\\/cdn.example.com\\/progressive.mp4?t=a\\u0026s=1"}]}
    </script></body></html>`;
  assert.strictEqual(
    extractVideoUrl(html),
    'https://cdn.example.com/progressive.mp4?t=a&s=1'
  );
});

test('decodeHtmlEntities decodes common entities', () => {
  assert.strictEqual(
    decodeHtmlEntities('a&amp;b&quot;c&#39;d'),
    'a&b"c\'d'
  );
});

test('INSTAGRAM_URL_REGEX accepts valid reel links', () => {
  assert.ok(INSTAGRAM_URL_REGEX.test('https://www.instagram.com/reel/Cabc123_/'));
  assert.ok(INSTAGRAM_URL_REGEX.test('https://instagram.com/p/XYZ-9/'));
});

test('INSTAGRAM_URL_REGEX rejects non-instagram links', () => {
  assert.ok(!INSTAGRAM_URL_REGEX.test('https://youtube.com/watch?v=123'));
  assert.ok(!INSTAGRAM_URL_REGEX.test('not a url'));
});

// Exercise 5 — JSON fallback (Exercise 1)
test('extractVideoUrl falls back to JSON video_url when no og:video', () => {
  const html = `
    <html><head><title>no meta video</title></head>
    <body><script type="application/json">
      {"items":[{"video_url":"https:\\/\\/cdn.example.com\\/v.mp4?t=a\\u0026s=1"}]}
    </script></body></html>`;
  const url = extractVideoUrl(html);
  assert.strictEqual(url, 'https://cdn.example.com/v.mp4?t=a&s=1');
});

test('unescapeJsonString un-escapes slashes and unicode', () => {
  assert.strictEqual(
    unescapeJsonString('https:\\/\\/x.com\\/a\\u0026b'),
    'https://x.com/a&b'
  );
});

// Exercise 5 — metadata extraction (Exercise 2)
test('extractMetadata pulls thumbnail, caption and username', () => {
  const html = `
    <html><head>
      <meta property="og:image" content="https://cdn.example.com/thumb.jpg" />
      <meta property="og:title" content="My caption (@cool_user)" />
    </head></html>`;
  const meta = extractMetadata(html);
  assert.strictEqual(meta.thumbnail, 'https://cdn.example.com/thumb.jpg');
  assert.strictEqual(meta.caption, 'My caption (@cool_user)');
  assert.strictEqual(meta.username, 'cool_user');
});

test('extractMetadata prefers username from JSON when present', () => {
  const html = `
    <html><head>
      <meta property="og:description" content="some text" />
    </head><body><script>{"username":"json_user"}</script></body></html>`;
  const meta = extractMetadata(html);
  assert.strictEqual(meta.username, 'json_user');
  assert.strictEqual(meta.caption, 'some text');
  assert.strictEqual(meta.thumbnail, null);
});

// toEmbedUrl builds the public embed endpoint
test('toEmbedUrl builds the public embed URL from a reel link', () => {
  assert.strictEqual(
    toEmbedUrl('https://www.instagram.com/reel/Cabc123_/'),
    'https://www.instagram.com/p/Cabc123_/embed/captioned/'
  );
  assert.strictEqual(toEmbedUrl('https://youtube.com/x'), null);
});
