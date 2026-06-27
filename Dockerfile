# syntax=docker/dockerfile:1

# ---- Stage 1: build the React (Vite) frontend ----
FROM node:20-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: runtime (Express backend + yt-dlp + ffmpeg) ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production

# System dependencies:
#  - python3 + venv: runs yt-dlp (the robust extractor / login-wall fallback)
#  - ffmpeg: enables .mp3 audio export and higher-resolution merges
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       python3 python3-venv ffmpeg ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*

# Install yt-dlp into an isolated virtualenv so it never clashes with system
# Python (avoids PEP 668 "externally managed" errors on Debian).
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip yt-dlp
ENV PYTHON_PATH=/opt/venv/bin/python

WORKDIR /app

# Install backend production dependencies first (better layer caching).
COPY backend/package*.json ./backend/
RUN npm ci --omit=dev --prefix backend

# Copy backend source.
COPY backend/ ./backend/

# Copy the built frontend from stage 1 (the backend serves ../frontend/dist).
COPY --from=frontend /app/frontend/dist ./frontend/dist

# Writable folder for server-side saves; owned by the non-root node user.
RUN mkdir -p /app/downloads && chown -R node:node /app

ENV PORT=3000
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" || exit 1

CMD ["node", "backend/src/server.js"]
