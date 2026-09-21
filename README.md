# Resonant — YouTube → Audio

Monorepo product: polished web converter, yt-dlp API, and iOS Share Extension.

> **Ethics:** Only download content you have rights to. YouTube ToS may restrict downloading. Public watch URLs and public playlists only — no credential scraping, no DRM bypass.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌────────────┐
│  Next.js    │────▶│  FastAPI + yt-dlp │────▶│  ffmpeg    │
│  /web       │     │  /api             │     │  audio out │
└─────────────┘     └──────────────────┘     └────────────┘
        ▲
        │  ?url=
┌───────┴───────┐
│ iOS Share Ext │  youtube.com / youtu.be / playlists
└───────────────┘
```

| Path | Stack |
|------|--------|
| `/web` | Next.js 14, TypeScript, Tailwind — landing + `/convert` |
| `/api` | Python FastAPI, yt-dlp, ffmpeg — meta + convert + playlist ZIP |
| `/ios` | SwiftUI shell + Share Extension (unsigned source) |

## Quick start (local, no Docker)

### Prerequisites

- Python 3.11+, Node 20+, ffmpeg on `PATH`
- yt-dlp (installed via the project venv)

```bash
cd /workspace/youtube-audio   # or your clone path

# API
python3 -m venv .venv
.venv/bin/pip install -r api/requirements.txt
export DOWNLOAD_DIR="$PWD/downloads"
.venv/bin/uvicorn app.main:app --app-dir api --host 127.0.0.1 --port 8000

# Web (other terminal)
cd web
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
npm install
npm run dev
```

Open **http://127.0.0.1:3000** — converter at **/convert** (supports `?url=`).

Or: `./scripts/dev.sh` (starts API + web).

### API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health + ethics notice + playlist caps |
| GET | `/api/status` | Operator status (cookies flag, download dir, hosting hint) |
| GET/POST | `/api/meta` | Single-video metadata preview |
| POST | `/api/convert` | Body `{ "url", "quality": "best"\|"256"\|"128" }` |
| GET | `/api/download/{job}/{file}` | Download extracted audio |
| GET | `/api/stream?url=&quality=` | Convert + stream attachment |
| GET/POST | `/api/playlist/meta` | Playlist listing (flat, capped) |
| POST | `/api/playlist/convert` | Body `{ "url", "quality", "ids"? }` → ZIP of audio |

### Playlists

Accepts `youtube.com/playlist?list=…`, watch URLs with `&list=`, and `youtu.be` URLs with `list=`.

- **Listing** uses yt-dlp `extract_flat` and caps at **100** entries (`PLAYLIST_LIST_CAP`).
- **Bulk convert** returns a ZIP; max **30** tracks per request (`PLAYLIST_CONVERT_CAP`), concurrency **2** (`PLAYLIST_CONCURRENCY`) — tuned for Render free-tier timeouts. Pass `ids` to convert a subset.
- Public playlists only; private / login-walled / DRM content returns a clear error.

### Quality options

- **best** — prefer m4a, highest available bitrate  
- **256** — AAC m4a ~256 kbps  
- **128** — MP3 128 kbps  

## Docker Compose

```bash
docker compose up --build
```

- Web: http://localhost:3000  
- API: http://localhost:8000  

(Requires Docker on the host. This box may not have Docker installed.)

## iOS Share Extension

See [`ios/README.md`](ios/README.md) for Xcode setup, bundle IDs, and activation rules.

Bundle IDs:

- App: `com.resonant.youtubeaudio`
- Share: `com.resonant.youtubeaudio.share`

## How to test conversion

1. Start API + web as above.
2. Use a **short public / Creative Commons** YouTube URL or playlist you have rights to.
3. Or curl:

```bash
curl -s "http://127.0.0.1:8000/api/meta?url=https://www.youtube.com/watch?v=VIDEO_ID" | jq .
curl -s "http://127.0.0.1:8000/api/playlist/meta?url=https://www.youtube.com/playlist?list=PLAYLIST_ID" | jq .
curl -s -X POST http://127.0.0.1:8000/api/convert \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=VIDEO_ID","quality":"128"}' | jq .
```

If the network blocks YouTube, the code path is real — verify `/health` shows ffmpeg ready and re-try when network allows.

## PWA

`/web/public/manifest.webmanifest` + SVG icon — installable on mobile browsers.


## Cookie-free hosting

When YouTube blocks Render’s datacenter IP, run the API off-Render (e.g. this
box) and expose it with a Cloudflare quick tunnel. Keep **resonant-web** on
Render and set `API_INTERNAL_URL` to the tunnel HTTPS URL so `/api-proxy` works
for visitors **without YouTube cookies**.

```bash
./scripts/keep-api-tunnel.sh
# then set Render resonant-web API_INTERNAL_URL to the printed URL and redeploy
```

Details: [`docs/RENDER.md`](docs/RENDER.md#cookie-free-hosting-box-api--cloudflare-tunnel).
Tunnel URLs change on restart — update the Render env each time.

## License / affiliation

Not affiliated with YouTube or Google. Use responsibly.
