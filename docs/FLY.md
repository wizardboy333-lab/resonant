# Fly.io deployment

Resonant runs as two Fly apps in the `iad` region:

- `resonant-api` — FastAPI, yt-dlp, and ffmpeg from [`api/`](../api/)
- `resonant-web` — Next.js from [`web/`](../web/)

The browser calls same-origin `/api-proxy`. The web server rewrites that path to
`http://resonant-api.internal:8000` over Fly's private network. The production
Docker build intentionally leaves `NEXT_PUBLIC_API_URL` empty; do not pass a
localhost value as a production build argument.

## First deployment

Run these steps from a machine with the repository checked out. Do not put the
token in source control. Set `FLY_API_TOKEN` before running the commands below.

### 1. Install and authenticate flyctl

On Linux/macOS, install `flyctl` with the official installer (or use the
package-manager instructions at <https://fly.io/docs/flyctl/install/>):

```bash
curl -L https://fly.io/install.sh | sh
export PATH="$HOME/.fly/bin:$PATH"  # use the path printed by the installer if different
fly version

export FLY_API_TOKEN='paste-your-Fly-token-here'
fly auth token
```

`FLY_API_TOKEN` is what the deploy commands use. On flyctl versions where
`fly auth token` is not available, authenticate the local CLI with
`fly auth login` (or pass `--access-token "$FLY_API_TOKEN"`); do not print or
commit the token.

### 2. Create both apps

```bash
fly apps create resonant-api
fly apps create resonant-web
```

If your Fly organization is not the default, add its slug, for example
`--org my-org`, to each command.

### 3. Create the API volume

The API config mounts a 1 GB Fly volume at `/tmp/ytaudio`, so completed files
remain available after a machine restart. Create one in the configured region
before deploying:

```bash
fly volumes create ytaudio_data --app resonant-api --region iad --size 1 --yes
```

Keep the API at one machine unless each machine is given its own volume and the
application is changed to use shared/object storage. The volume is not a backup.

### 4. Deploy from each app directory

```bash
cd api
fly deploy --config fly.toml --remote-only --yes

cd ../web
fly deploy --config fly.toml --remote-only --yes
```

Or, after the volume and apps exist, run the repository helper:

```bash
./scripts/fly-deploy.sh
```

Check both apps after deployment:

```bash
fly status --app resonant-api
fly status --app resonant-web
fly logs --app resonant-api
```

## Attach a custom `.com` domain

Point the domain at the web app, not the API app. Replace the examples with
your real domain:

```bash
fly certs add example.com --app resonant-web
fly certs add www.example.com --app resonant-web
fly certs show example.com --app resonant-web
fly ips list --app resonant-web
```

At your DNS provider, use the addresses shown by `fly ips list` for the apex
(`@`): an **A** record for IPv4 and an **AAAA** record for IPv6. For `www`,
use a **CNAME** to `resonant-web.fly.dev` (or use the addresses Fly reports).
Then verify certificate issuance and DNS propagation:

```bash
fly certs check example.com --app resonant-web
fly certs check www.example.com --app resonant-web
```

## Operational caveats

- Free/low-cost Fly plans and auto-stop settings may sleep an idle machine, so
  the first request can be slow; quotas and pricing can change.
- `yt-dlp` may be blocked or challenged by YouTube from datacenter IP ranges.
  A successful deployment does not guarantee every YouTube URL will convert.
- `CORS_ORIGINS=*` is intentionally permissive for now. Tighten it to the web
  origin if the API is ever exposed directly.
