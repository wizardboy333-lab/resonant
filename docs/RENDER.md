# Render deployment

Resonant can run on Render as two Docker web services managed by the root
[`render.yaml`](../render.yaml) Blueprint:

- **resonant-api** — FastAPI, yt-dlp, and ffmpeg from [`api/`](../api/)
- **resonant-web** — Next.js from [`web/`](../web/)

The web service serves the UI and proxies browser requests through
`/api-proxy/*`. The Blueprint sets `API_INTERNAL_URL` to
`https://resonant-api.onrender.com`, so the Next.js server makes the API call
server-side instead of exposing an API URL in the browser. This public URL is
intentional for the free web-service setup; if you later use a documented
Render private-network address, set `API_INTERNAL_URL` to that full URL instead.
Render private hostnames are generated per service (for example,
`<generated-hostname>:<port>`); do not assume `http://resonant-api:10000` is a
valid address. Use the address shown in the service's **Connect → Internal**
panel, prefixed with `http://`, and keep both services in the same region.

## Create the services

1. Push the repository, including `render.yaml`, to GitHub. Render Blueprints
   are imported from a GitHub repository; this guide does not require or perform
   authentication from the project.
2. In the Render Dashboard, choose **New → Blueprint**.
3. Connect GitHub, select the repository and branch, and confirm the detected
   `render.yaml`.
4. Review the two `free` web services and create the Blueprint. Do not add a
   disk for the API: downloads use `/tmp/ytaudio`, which is ephemeral and
   appropriate for the free tier.
5. Wait for both services to finish building. The API's health check is
   `/health`.

The expected URLs are:

- Web UI: `https://resonant-web.onrender.com`
- API: `https://resonant-api.onrender.com`

Render-generated URLs can differ if a name is already taken or you rename a
service. If the API URL changes, update `API_INTERNAL_URL` on `resonant-web`
and redeploy it. Keep `NEXT_PUBLIC_API_URL` empty so production requests stay
same-origin and continue through `/api-proxy`.

## Custom domain

Add the custom domain to **resonant-web**, not the API service:

1. Open `resonant-web` in Render and choose **Settings → Custom Domains**.
2. Add the domain (and `www` if desired).
3. Copy the DNS records Render provides into your DNS provider and wait for
   certificate issuance and DNS propagation.

The API can remain on its Render URL because the web server performs the proxy.

## Free-tier caveats

- Free services sleep after roughly 15 minutes without traffic. The first
  request after sleeping can take a while while the service starts; this is
  normal.
- `/tmp/ytaudio` is ephemeral. Files can disappear when the service restarts,
  and free disk/storage capacity is limited. Do not treat it as permanent
  storage.
- `yt-dlp` may be blocked or challenged by YouTube from datacenter IP ranges.
  A healthy Render deployment does not guarantee that every YouTube URL will
  convert. Optional cookies (see below) can help when the host is blocked.
- The API uses `CORS_ORIGINS=*` as requested. If the API is ever exposed to
  browser clients directly, replace it with the web origin.

## YouTube cookies (optional, for host blocks)

Datacenter IPs (including Render free tier) are often challenged or blocked by
YouTube. If converts fail with a **403** about login, membership, or bot-check,
you can supply a Netscape `cookies.txt` from a logged-in browser session.

**Treat cookies like a password.** Never commit them to git. Rotate or revoke
the session if the file may have leaked.

### Export cookies

1. Install a browser extension such as **Get cookies.txt LOCALLY**
   (Chrome/Firefox). Prefer a local-only exporter that does not upload your
   cookies.
2. Open [youtube.com](https://www.youtube.com) while signed in.
3. Export cookies for `youtube.com` (Netscape `cookies.txt` format).
4. Keep the file off the repository (see `.gitignore` for `cookies*.txt`).

### Configure on Render

**Option A — secret env (recommended for free tier)**

1. Open **resonant-api → Environment**.
2. Add a **secret** env var named `YTDLP_COOKIES`.
3. Paste the full multiline contents of your `cookies.txt` as the value.
4. Save and redeploy the API. On startup the service writes the value to
   `/tmp/ytdlp-cookies.txt` and passes it to yt-dlp as `cookiefile`.

**Option B — file path**

1. Place a Netscape cookies file on the instance (e.g. a mounted secret file).
2. Set env `YTDLP_COOKIES_FILE` to that absolute path.
3. Redeploy. The path is used only if the file exists.

`YTDLP_COOKIES_FILE` wins when the path exists; otherwise `YTDLP_COOKIES` is
used. Cookies expire — re-export and update the env when converts start failing
again. This does not guarantee every URL will work; it only improves odds on
blocked hosts.

## Cookie-free hosting (box API + Cloudflare tunnel)

Prefer this path when YouTube blocks Render datacenter IPs and you do **not**
want to store YouTube cookies on the API service.

Architecture:

1. Keep **resonant-web** on Render (UI + `/api-proxy`).
2. Run the Resonant API on a non-datacenter host (this box) at
   `http://127.0.0.1:8000` with `DOWNLOAD_DIR` set.
3. Expose **only the API** with a Cloudflare quick tunnel:
   `cloudflared tunnel --url http://127.0.0.1:8000`.
4. Point Render web env `API_INTERNAL_URL` at the tunnel HTTPS URL (no trailing
   slash). Leave `NEXT_PUBLIC_API_URL` empty so browsers stay same-origin.

Helper script (starts API if needed, starts tunnel, prints URL):

```bash
./scripts/keep-api-tunnel.sh
```

Log defaults to `/workspace/cloudflared-api.log`; the active URL is also written
to `/workspace/api-tunnel-url.txt`.

### Update Render after every tunnel restart

Quick tunnels (`*.trycloudflare.com`) mint a **new hostname on every restart**.
After re-running `keep-api-tunnel.sh`:

1. Open **resonant-web → Environment** in the Render Dashboard.
2. Set `API_INTERNAL_URL` to the new `https://….trycloudflare.com` value
   (no trailing slash).
3. Save and **Manual Deploy** the web service (or wait for the env-change
   restart).

Verify the tunnel before switching Render:

```bash
curl -sS "$URL/health"
curl -sS "$URL/api/meta?url=https://www.youtube.com/watch?v=jNQXAC9IVRw"
```

Do not put the tunnel URL in git or `render.yaml` — it is ephemeral. Cookies
remain optional (see below) if you keep the API on Render itself.

## Port handling

Render supplies a `PORT` environment variable. The API Dockerfile starts
Uvicorn on `0.0.0.0` and uses `${PORT:-8000}`, so local Docker usage still
defaults to port 8000 while Render can provide its assigned port. The Next.js
standalone server already honors `PORT`; no separate web start command is
needed.
