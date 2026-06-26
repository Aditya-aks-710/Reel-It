// Thin wrapper around the backend API. In dev, Vite proxies these paths to the
// Express server (see vite.config.js); in production the backend serves the
// built frontend from the same origin, so relative paths just work.

export async function resolveReel(url) {
  const res = await fetch('/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Could not resolve that reel.');
  }
  return data;
}

export function inlineStreamUrl(url) {
  return '/api/download?inline=1&url=' + encodeURIComponent(url);
}

export function downloadUrl(url, audioOnly) {
  const a = audioOnly ? '&audio=1' : '';
  return '/api/download?url=' + encodeURIComponent(url) + a;
}
