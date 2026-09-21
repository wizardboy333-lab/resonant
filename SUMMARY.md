# Resonant — build summary

**Project path:** `/workspace/youtube-audio`

## What was built

| Piece | Path | Notes |
|-------|------|--------|
| Web UI | `web/` | Next.js 14 + TS + Tailwind — dark “Resonant” brand, landing + `/convert?url=` |
| API | `api/` | FastAPI + yt-dlp + ffmpeg — meta, convert (best/256/128), download, stream |
| iOS | `ios/` | SwiftUI shell + Share Extension (unsigned Xcode source) |
| Compose | `docker-compose.yml` | API + web images (Docker not installed on this box) |
| Docs | `README.md`, `ios/README.md`, this file | |

## How to run (verified on this box)

```bash
# Terminal A — API
cd /workspace/youtube-audio
export DOWNLOAD_DIR=$PWD/downloads
.venv/bin/uvicorn app.main:app --app-dir api --host 127.0.0.1 --port 8000

# Terminal B — Web
cd /workspace/youtube-audio/web
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Or: `./scripts/dev.sh`

- Site: http://127.0.0.1:3000  
- Converter: http://127.0.0.1:3000/convert  
- API health: http://127.0.0.1:8000/health  

**Docker** (when available): `docker compose up --build`

## Verified tests (2026-09-20 ET)

- `GET /health` → ok, ffmpeg true  
- Meta + convert for `https://www.youtube.com/watch?v=jNQXAC9IVRw` (“Me at the zoo”)  
  - quality `128` → MP3 (~304 KB)  
  - quality `best` → m4a (~308 KB)  
- Download endpoint returns audio bytes  
- Web `/` and `/convert?url=…` return 200; converter shows metadata preview  

## Screenshots

- `docs/screenshots/landing.png`  
- `docs/screenshots/convert.png`  

## Tooling on this box

- **Installed:** Python venv with yt-dlp 2026.08.19, FastAPI, uvicorn; ffmpeg 7.1; Node 20; Next.js deps  
- **Not installed:** Docker / docker compose CLI — compose file is ready for hosts that have Docker  

## iOS

Open `ios/YouTubeAudio.xcodeproj` on macOS. Bundle IDs: `com.resonant.youtubeaudio` / `.share`. See `ios/README.md`.

## Ethics

In-UI notice on converter + footer: rights/ToS; public watch URLs only; no credentials/DRM bypass.
