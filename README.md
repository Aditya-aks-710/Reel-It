# Reel Downloader

A small full-stack app that takes a **public Instagram reel URL** and lets you
download it as **video + audio** or **audio only**. An Express API does the
heavy lifting — it warms a logged-out "guest" session and reads the reel's
embedded video data (no login required), with a `yt-dlp` fallback for the edge
cases. A React + Vite + Tailwind frontend gives you a clean, responsive UI with
a live preview.

> ⚠️ **Use responsibly.** Instagram has no official download API and downloading
> may violate its Terms of Service. Only download content you own or have
> permission to use. This project is for personal/educational use.

---

## Features

- Paste a public reel link, preview it inline, then download
- Choose **Video + audio** (`.mp4`) or **Audio only** (`.m4a`, extracted with
  ffmpeg when available)
- In-button progress + success animation
- No-login extraction: a logged-out guest session + browser-like headers expose
  the reel's `video_versions` (progressive MP4 with audio); falls back to
  `og:video`, the embed page, and finally **yt-dlp**
- Optional browser-cookie or `cookies.txt` support for stubborn reels
- In-memory resolve cache + rate limiting
- Fully responsive UI (flexbox layout, works on phones and desktops)

## Tech stack

- **Backend:** Node.js (18+), Express, yt-dlp (via a Python venv, used as a fallback)
- **Frontend:** React 18 + Vite + Tailwind CSS
- **Optional:** ffmpeg (enables real audio-only `.m4a` extraction)

## Project structure

```
reel-downloader/
├── package.json              # root scripts that delegate to backend/frontend
├── backend/
│   ├── .env.example
│   └── src/
│       ├── server.js         # starts the HTTP server
│       ├── app.js            # builds the Express app
│       ├── config/index.js   # env config + defaults
│       ├── routes/
│       ├── controllers/
│       ├── services/         # resolver + downloader + yt-dlp + cache
│       ├── middleware/       # url validation, rate limit, error handler
│       └── utils/
└── frontend/
    ├── vite.config.js
    ├── tailwind.config.js
    └── src/                  # App.jsx, api.js, styles.css, main.jsx
```

## Getting started

**Prerequisites**

- Node.js 18+
- Python 3 with `yt-dlp` (the backend defaults to a local `.venv`)
- _Optional:_ [ffmpeg](https://ffmpeg.org/) on your PATH for audio-only `.m4a`
  extraction (without it, "Audio only" falls back to the full MP4)

**Install**

```bash
npm run install:all          # installs backend + frontend deps
```

Set up the Python venv with yt-dlp (one time):

```bash
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install yt-dlp   # macOS/Linux: .venv/bin/python
cd ..
```

Create your env file:

```bash
copy backend\.env.example backend\.env       # macOS/Linux: cp
```

You can leave `.env` mostly blank — every value has a default. Optionally set
`COOKIES_FROM_BROWSER` or `COOKIES_FILE` to use your logged-in session.

**Run (two terminals)**

```bash
npm run dev          # backend API on http://localhost:3000
npm run frontend     # frontend on http://localhost:5173
```

Open http://localhost:5173, paste a public reel link, click **Find video**,
pick a mode, and hit **Download**.

### API

| Method | Endpoint                          | Description                          |
| ------ | --------------------------------- | ------------------------------------ |
| POST   | `/api/resolve`                    | Returns the direct video URL (JSON)  |
| GET    | `/api/download?url=...`           | Streams the file (`&audio=1` for audio only, `&inline=1` to preview) |
| GET    | `/health`                         | Health check                         |

### Run tests

```bash
npm test
```

---

## Run with Docker

The image bundles everything — Node, the built frontend, **yt-dlp**, and
**ffmpeg** (so audio-only downloads work as `.m4a`). No Python venv setup needed.

**Using docker compose (recommended):**

```bash
docker compose up --build
```

**Or plain Docker:**

```bash
docker build -t reel-downloader .
docker run --rm -p 3000:3000 reel-downloader
```

Then open http://localhost:3000 — the backend serves the built frontend, so the
whole app runs on a single port.

**Optional — beat the login wall with cookies:** export a `cookies.txt`
(Netscape format) and mount it in:

```bash
docker run --rm -p 3000:3000 \
  -e COOKIES_FILE=/app/cookies.txt \
  -v "$(pwd)/cookies.txt:/app/cookies.txt:ro" \
  reel-downloader
```

(or uncomment the matching lines in `docker-compose.yml`).

---

## How it works (the flow)

```
Browser ──URL──▶ /api/download
                      │
                      ▼
              validateUrl (middleware)
                      │
                      ▼
            resolver.service.resolveReel
              ├─ warm a guest session (cookies + browser headers)
              ├─ fetch reel HTML page
              ├─ parse video_versions / og:video / embed page
              └─ fall back to yt-dlp (last resort)
                      │
                      ▼
              stream video/audio ──▶ Browser
```

## Configuration

All settings live in `backend/.env` (see `backend/.env.example`). Highlights:

- `COOKIES_FROM_BROWSER` / `COOKIES_FILE` — use a logged-in session
- `FFMPEG_PATH` — point at ffmpeg to enable audio-only `.m4a` extraction
- `RATE_LIMIT_*`, `CACHE_TTL_MS` — tune throttling and caching

## License

MIT

