import { useEffect, useRef, useState } from 'react';
import { resolveReel, inlineStreamUrl, downloadUrl } from './api.js';

const INSTAGRAM_RE = /https?:\/\/(www\.)?instagram\.com\/(reel|reels|p|tv)\//i;

function filenameFor(url, audioOnly) {
  const m = url.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  const ext = audioOnly ? '.m4a' : '.mp4';
  return 'reel-' + (m ? m[2] : Date.now()) + ext;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [current, setCurrent] = useState(null); // resolved reel data + url
  const [status, setStatus] = useState({ msg: '', type: '' });
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // null = hidden, 0-100 = shown
  const [mode, setMode] = useState('video'); // 'video' | 'audio'
  const [done, setDone] = useState(false); // shows success burst
  const [clipReady, setClipReady] = useState(false); // clipboard has a reel link
  const playerRef = useRef(null);

  // Best-effort: peek at the clipboard and light up the paste button if it holds
  // an Instagram link. Reading silently requires clipboard-read permission
  // (Chromium); it fails quietly elsewhere.
  async function refreshClipboard() {
    if (!navigator.clipboard?.readText) return;
    try {
      const text = await navigator.clipboard.readText();
      setClipReady(INSTAGRAM_RE.test(text || ''));
    } catch {
      /* no permission / not focused — leave the button in its default state */
    }
  }

  // Re-check whenever the tab regains focus (e.g. after copying from another app).
  useEffect(() => {
    refreshClipboard();
    window.addEventListener('focus', refreshClipboard);
    return () => window.removeEventListener('focus', refreshClipboard);
  }, []);

  const setOk = (msg) => setStatus({ msg, type: 'ok' });
  const setErr = (msg) => setStatus({ msg, type: 'error' });

  function resetResult() {
    setCurrent(null);
    setProgress(null);
    setMode('video');
    setDone(false);
  }

  async function handleFind() {
    const link = url.trim();
    resetResult();
    if (!link) return setErr('Please paste a reel link first.');

    setFinding(true);
    setStatus({ msg: 'Finding video…', type: 'ok', spin: true });
    try {
      const data = await resolveReel(link);
      setCurrent({ url: link, ...data });
      setOk('Found it. Now hit download, you knew you would.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setFinding(false);
    }
  }

  async function handleDownload() {
    if (!current) return;
    setBusy(true);
    setDone(false);
    setProgress(0);
    setStatus({ msg: 'Downloading…', type: 'ok', spin: true });
    try {
      const res = await fetch(downloadUrl(current.url, mode === 'audio'));
      if (!res.ok) {
        let msg = 'Download failed.';
        try {
          msg = (await res.json()).error || msg;
        } catch {
          /* not json */
        }
        throw new Error(msg);
      }
      const total = Number(res.headers.get('Content-Length')) || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total) setProgress((received / total) * 100);
      }
      setProgress(100);

      const blob = new Blob(chunks, { type: mode === 'audio' ? 'audio/mp4' : 'video/mp4' });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filenameFor(current.url, mode === 'audio');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      setStatus({ msg: '', type: '' });
      setDone(true);
      window.gtag?.('event', 'download', { mode });
      setTimeout(() => setDone(false), 1000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(null), 800);
    }
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
      setClipReady(false);
    } catch {
      setStatus({ msg: 'Clipboard blocked — paste manually with Ctrl+V.', type: 'muted' });
    }
  }

  function handleClear() {
    setUrl('');
    resetResult();
    setStatus({ msg: '', type: '' });
    refreshClipboard();
  }

  const statusColor =
    status.type === 'error' ? 'text-err' : status.type === 'ok' ? 'text-ok' : 'text-muted';

  return (
    <div className="flex min-h-[100dvh] w-full justify-center overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:items-center">
      <main className="my-auto flex w-full max-w-[480px] animate-rise flex-col rounded-3xl border border-white/[0.06] bg-card p-5 shadow-[0_20px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:p-6">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-[10px] bg-gradient-to-br from-accent3 via-accent to-accent2 text-lg">
            ▶
          </div>
          <h1 className="m-0 text-xl font-semibold tracking-tight">Reel Downloader</h1>
        </div>
        <p className="mb-4 mt-1.5 text-sm text-muted">
          Paste a public Instagram reel link to preview and download it.
        </p>

        <div className="flex items-center gap-1 rounded-xl border border-stroke bg-ink pr-1.5 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setDone(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleFind()}
            placeholder="https://www.instagram.com/reel/XXXXXXXXX/"
            autoComplete="off"
            spellCheck="false"
            className="min-w-0 flex-1 bg-transparent px-3.5 py-3 text-[16px] text-white outline-none placeholder:text-muted"
          />
          <button
            className={
              'grid h-8 w-8 shrink-0 place-items-center rounded-lg transition ' +
              (clipReady
                ? 'text-accent hover:bg-white/5'
                : 'text-muted hover:bg-white/5 hover:text-white')
            }
            title={clipReady ? 'Paste the copied Instagram link' : 'Paste from clipboard'}
            onClick={handlePaste}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[18px] w-[18px]"
              aria-hidden="true"
            >
              <rect x="8" y="2" width="8" height="4" rx="1" />
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            </svg>
          </button>
          <button
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-white/5 hover:text-white"
            title="Clear"
            onClick={handleClear}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[18px] w-[18px]"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-3 flex">
          <button
            className="flex-1 rounded-xl bg-gradient-to-br from-accent to-accent2 px-3.5 py-3 text-[0.98rem] font-semibold text-white transition hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleFind}
            disabled={finding}
          >
            {finding ? 'Finding…' : 'Find video'}
          </button>
        </div>

        {finding && !current && (
          <section className="mt-4 animate-rise">
            <div
              className="flex aspect-[9/16] max-h-[min(70dvh,560px)] w-full flex-col items-center justify-center gap-3.5 rounded-2xl border border-stroke bg-[linear-gradient(110deg,#11141a_30%,#1a1f29_50%,#11141a_70%)] bg-[length:220%_100%] text-muted animate-shimmer"
              aria-hidden="true"
            >
              <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/10 border-t-accent" />
              <span className="text-sm tracking-wide">Fetching video…</span>
            </div>
          </section>
        )}

        {current && (
          <section className="mt-4 flex animate-rise flex-col">
            <video
              ref={playerRef}
              src={inlineStreamUrl(current.url)}
              controls
              preload="metadata"
              playsInline
              className="block max-h-[min(70dvh,560px)] w-full rounded-2xl bg-black object-contain"
            />
            <div
              className="mt-3 flex gap-1.5 rounded-xl border border-stroke bg-ink p-1.5"
              role="group"
              aria-label="Download type"
            >
              <button
                type="button"
                className={
                  'flex-1 rounded-lg px-2.5 py-2 text-[0.88rem] font-semibold transition disabled:opacity-60 ' +
                  (mode === 'video'
                    ? 'bg-gradient-to-br from-accent to-accent2 text-white'
                    : 'text-muted hover:text-white')
                }
                onClick={() => {
                  setMode('video');
                  setDone(false);
                }}
                disabled={busy}
              >
                🎬 Video + audio
              </button>
              <button
                type="button"
                className={
                  'flex-1 rounded-lg px-2.5 py-2 text-[0.88rem] font-semibold transition disabled:opacity-60 ' +
                  (mode === 'audio'
                    ? 'bg-gradient-to-br from-accent to-accent2 text-white'
                    : 'text-muted hover:text-white')
                }
                onClick={() => {
                  setMode('audio');
                  setDone(false);
                }}
                disabled={busy}
              >
                🎵 Audio only
              </button>
            </div>
            <div className="mt-3.5 flex">
              <button
                className={
                  'relative isolate flex-1 overflow-hidden rounded-xl px-3.5 py-3 font-semibold text-white transition disabled:cursor-default ' +
                  (done
                    ? 'animate-dlpop bg-gradient-to-br from-[#2fb344] to-ok'
                    : 'bg-gradient-to-br from-accent to-accent2 hover:brightness-110')
                }
                onClick={handleDownload}
                disabled={busy || done}
              >
                {progress != null && (
                  <span
                    className="absolute inset-y-0 left-0 -z-10 bg-gradient-to-r from-white/30 to-white/10 transition-[width] duration-150"
                    style={{ width: Math.max(0, Math.min(100, progress)) + '%' }}
                  />
                )}
                <span className="inline-flex items-center justify-center gap-2">
                  {done ? (
                    <>
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
                        <path className="dl-check-path" d="M5 13l4 4 10-11" />
                      </svg>
                      Downloaded
                    </>
                  ) : busy ? (
                    <>
                      <span className="h-[15px] w-[15px] shrink-0 animate-spin rounded-full border-2 border-white/45 border-t-white" />
                      {progress != null ? `Downloading ${Math.round(progress)}%` : 'Downloading…'}
                    </>
                  ) : (
                    <>⬇ Download</>
                  )}
                </span>
              </button>
            </div>
          </section>
        )}

        <div className={'mt-3.5 min-h-[1.2em] text-center text-[0.88rem] ' + statusColor}>
          {status.spin && (
            <span className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white align-[-2px]" />
          )}
          {status.msg}
        </div>

        <footer className="mt-4 text-center text-[0.72rem] leading-relaxed text-muted">
          Because screenshotting a video was just too much effort. You&apos;re welcome.
        </footer>
      </main>
    </div>
  );
}
