# Reel Downloader

A small full-stack app that takes a **public Instagram reel URL** and lets you
download it as **video + audio** or **audio only**. An Express API does the
heavy lifting (with a `yt-dlp` fallback that beats Instagram's login wall) and a
React + Vite frontend gives you a clean, responsive UI with a live preview.

> ⚠️ **Use responsibly.** Instagram has no official download API and downloading
> may violate its Terms of Service. Only download content you own or have
> permission to use. This project is for personal/educational use.

---

## Features

- Paste a public reel link, preview it inline, then download
- Choose **Video + audio** (`.mp4`) or **Audio only** (`.m4a`, or `.mp3` if
  ffmpeg is installed)
- In-button progress + success animation
- Robust extraction: HTML `og:video` / embedded JSON / embed page, with a
  **yt-dlp** fallback for when scraping isn't enough
- Optional browser-cookie or `cookies.txt` support to beat the login wall
- In-memory resolve cache + rate limiting
- Fully responsive UI (works on phones and desktops)

## Tech stack

- **Backend:** Node.js (18+), Express, yt-dlp (via a Python venv)
- **Frontend:** React 18 + Vite
- **Optional:** ffmpeg (enables `.mp3` audio and higher-res merges)

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
    └── src/                  # App.jsx, api.js, styles.css, main.jsx
```

## Getting started

**Prerequisites**

- Node.js 18+
- Python 3 with `yt-dlp` (the backend defaults to a local `.venv`)
- _Optional:_ [ffmpeg](https://ffmpeg.org/) on your PATH for `.mp3` audio

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

## How it works (the flow)

```
Browser ──URL──▶ /api/download
                      │
                      ▼
              validateUrl (middleware)
                      │
                      ▼
            resolver.service.resolveReel
              ├─ fetch reel HTML page
              ├─ try og:video / embedded JSON / embed page
              └─ fall back to yt-dlp (beats login wall)
                      │
                      ▼
              stream video/audio ──▶ Browser
```

## Configuration

All settings live in `backend/.env` (see `backend/.env.example`). Highlights:

- `COOKIES_FROM_BROWSER` / `COOKIES_FILE` — use a logged-in session
- `FFMPEG_PATH` — point at ffmpeg to enable `.mp3` audio
- `RATE_LIMIT_*`, `CACHE_TTL_MS` — tune throttling and caching

## License

MIT

