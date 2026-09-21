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
  convert.
- The API uses `CORS_ORIGINS=*` as requested. If the API is ever exposed to
  browser clients directly, replace it with the web origin.

## Port handling

Render supplies a `PORT` environment variable. The API Dockerfile starts
Uvicorn on `0.0.0.0` and uses `${PORT:-8000}`, so local Docker usage still
defaults to port 8000 while Render can provide its assigned port. The Next.js
standalone server already honors `PORT`; no separate web start command is
needed.
