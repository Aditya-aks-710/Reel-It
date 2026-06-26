import { useRef, useState } from 'react';
import { resolveReel, inlineStreamUrl, downloadUrl } from './api.js';

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
  const playerRef = useRef(null);

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
    } catch {
      setStatus({ msg: 'Clipboard blocked — paste manually with Ctrl+V.', type: 'muted' });
    }
  }

  function handleClear() {
    setUrl('');
    resetResult();
    setStatus({ msg: '', type: '' });
  }

  return (
    <main className="card">
      <div className="brand">
        <div className="logo">▶</div>
        <h1>Reel Downloader</h1>
      </div>
      <p className="sub">
        Paste a public Instagram reel link to preview and download it.
      </p>

      <div className="field">
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
        />
        <button className="icon-btn" title="Paste from clipboard" onClick={handlePaste}>
          📋
        </button>
        <button className="icon-btn" title="Clear" onClick={handleClear}>
          ✕
        </button>
      </div>

      <div className="actions">
        <button className="primary" onClick={handleFind} disabled={finding}>
          {finding ? 'Finding…' : 'Find video'}
        </button>
      </div>

      {finding && !current && (
        <section className="result show">
          <div className="skeleton" aria-hidden="true">
            <span className="skeleton-spinner" />
            <span className="skeleton-text">Fetching video…</span>
          </div>
        </section>
      )}

      {current && (
        <section className="result show">
          <video
            ref={playerRef}
            src={inlineStreamUrl(current.url)}
            controls
            preload="metadata"
            playsInline
          />
          <div className="mode" role="group" aria-label="Download type">
            <button
              type="button"
              className={mode === 'video' ? 'active' : ''}
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
              className={mode === 'audio' ? 'active' : ''}
              onClick={() => {
                setMode('audio');
                setDone(false);
              }}
              disabled={busy}
            >
              🎵 Audio only
            </button>
          </div>
          <div className="actions">
            <button
              className={'primary dl' + (done ? ' is-done' : '') + (busy ? ' is-loading' : '')}
              onClick={handleDownload}
              disabled={busy || done}
            >
              {progress != null && (
                <span
                  className="dl-fill"
                  style={{ width: Math.max(0, Math.min(100, progress)) + '%' }}
                />
              )}
              <span className="dl-label">
                {done ? (
                  <>
                    <svg viewBox="0 0 24 24" className="dl-check" aria-hidden="true">
                      <path d="M5 13l4 4 10-11" />
                    </svg>
                    Downloaded
                  </>
                ) : busy ? (
                  <>
                    <span className="dl-spinner" />
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

      <div className={'status ' + (status.type || '')}>
        {status.spin && <span className="spinner" />}
        {status.msg}
      </div>

      <footer>
        Because screenshotting a video was just too much effort. You&apos;re
        welcome.
      </footer>
    </main>
  );
}
