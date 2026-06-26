'use strict';

/**
 * Quick diagnostic: checks what Instagram actually returns for a reel URL,
 * on both the normal page and the public embed endpoint.
 *
 * Usage:
 *   node scripts/diagnose.js "https://www.instagram.com/reel/XXXX/"
 */

const {
  resolveReel,
  extractVideoUrl,
  toEmbedUrl,
} = require('../src/services/resolver.service');
const config = require('../src/config');

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/diagnose.js "<reel url>"');
  process.exit(1);
}

async function fetchText(target) {
  const res = await fetch(target, {
    headers: {
      'User-Agent': config.userAgent,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  return { status: res.status, html: await res.text() };
}

function report(label, html) {
  console.log(`\n--- ${label} ---`);
  console.log('bytes:', html.length);
  console.log('has og:video :', /property=["']og:video["']/i.test(html));
  console.log('has video_url:', html.includes('video_url'));
  console.log('looks like login wall:', /login|loginForm|"viewer"\s*:\s*null/i.test(html));
  console.log('extracted    :', extractVideoUrl(html));
}

(async () => {
  try {
    const main = await fetchText(url);
    console.log('main page status:', main.status);
    report('MAIN PAGE', main.html);

    const embed = toEmbedUrl(url);
    if (embed) {
      const e = await fetchText(embed);
      console.log('\nembed url:', embed, '| status:', e.status);
      report('EMBED PAGE', e.html);
    }

    console.log('\n=== resolveReel() result ===');
    const result = await resolveReel(url);
    console.log(result);
  } catch (err) {
    console.error('\nresolveReel failed:', err.statusCode || '', err.message);
  }
})();
