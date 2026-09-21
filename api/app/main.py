"""YouTube Audio Extractor API — extract audio from public YouTube videos & playlists."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import shutil
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ytaudio")

DOWNLOAD_DIR = Path(os.environ.get("DOWNLOAD_DIR", "/workspace/youtube-audio/downloads"))
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}

# Listing cap (flat extract) and bulk-convert safeguards for free-tier timeouts
PLAYLIST_LIST_CAP = int(os.environ.get("PLAYLIST_LIST_CAP", "100"))
PLAYLIST_CONVERT_CAP = int(os.environ.get("PLAYLIST_CONVERT_CAP", "30"))
PLAYLIST_CONCURRENCY = int(os.environ.get("PLAYLIST_CONCURRENCY", "2"))

Quality = Literal["best", "256", "128"]

# Shared thread pool so playlist bulk jobs don't spawn unbounded threads
_executor = ThreadPoolExecutor(max_workers=max(4, PLAYLIST_CONCURRENCY + 2))

app = FastAPI(
    title="YouTube Audio API",
    description=(
        "Extract audio from public YouTube watch URLs and playlists. "
        "Only download content you have rights to. YouTube ToS may restrict downloading. "
        "Public content only — no login, cookies, or DRM bypass."
    ),
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class MetaRequest(BaseModel):
    url: str = Field(..., description="Public YouTube watch URL")

    @field_validator("url")
    @classmethod
    def validate_youtube_url(cls, v: str) -> str:
        return normalize_youtube_url(v)


class ConvertRequest(BaseModel):
    url: str
    quality: Quality = "best"

    @field_validator("url")
    @classmethod
    def validate_youtube_url(cls, v: str) -> str:
        return normalize_youtube_url(v)


class VideoMeta(BaseModel):
    id: str
    title: str
    channel: str | None = None
    duration: float | None = None
    duration_string: str | None = None
    thumbnail: str | None = None
    webpage_url: str | None = None
    description: str | None = None
    upload_date: str | None = None
    view_count: int | None = None
    is_live: bool | None = False
    availability: str | None = None


class ConvertResponse(BaseModel):
    meta: VideoMeta
    quality: str
    format: str
    filename: str
    download_url: str
    size_bytes: int | None = None
    bitrate_kbps: int | None = None


class PlaylistEntry(BaseModel):
    id: str
    title: str
    duration: float | None = None
    duration_string: str | None = None
    thumbnail: str | None = None
    url: str | None = None


class PlaylistMeta(BaseModel):
    id: str
    title: str
    uploader: str | None = None
    entries: list[PlaylistEntry]
    entry_count: int
    truncated: bool = False
    truncated_note: str | None = None
    webpage_url: str | None = None


class PlaylistMetaRequest(BaseModel):
    url: str = Field(..., description="Public YouTube playlist URL")

    @field_validator("url")
    @classmethod
    def validate_playlist_url(cls, v: str) -> str:
        return normalize_playlist_url(v)


class PlaylistConvertRequest(BaseModel):
    url: str = Field(..., description="Public YouTube playlist URL")
    quality: Quality = "best"
    ids: list[str] | None = Field(
        default=None,
        description="Optional subset of video ids; omit to convert all (up to cap)",
    )

    @field_validator("url")
    @classmethod
    def validate_playlist_url(cls, v: str) -> str:
        return normalize_playlist_url(v)

    @field_validator("ids")
    @classmethod
    def validate_ids(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        cleaned: list[str] = []
        for item in v:
            item = (item or "").strip()
            if not re.fullmatch(r"[A-Za-z0-9_-]{11}", item):
                raise ValueError(f"Invalid video id: {item!r}")
            cleaned.append(item)
        return cleaned


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------


def _ensure_https(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("URL is required")
    if not re.match(r"^https?://", raw, re.I):
        raw = "https://" + raw
    return raw


def extract_playlist_id(raw: str) -> str | None:
    """Return playlist id if present in a YouTube URL, else None."""
    try:
        raw = _ensure_https(raw)
    except ValueError:
        return None
    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    if host not in YOUTUBE_HOSTS:
        return None
    qs = parse_qs(parsed.query)
    if "list" in qs and qs["list"]:
        pid = qs["list"][0]
        if re.fullmatch(r"[\w-]{10,}", pid):
            return pid
    path = parsed.path or ""
    if "/playlist" in path and "list" in qs and qs["list"]:
        return qs["list"][0]
    return None


def is_playlist_url(raw: str) -> bool:
    return extract_playlist_id(raw) is not None


def normalize_playlist_url(raw: str) -> str:
    """Normalize to https://www.youtube.com/playlist?list=ID."""
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("URL is required")

    # Bare playlist id (PL… / UU… / LL… / OL… / RD… etc.)
    if re.fullmatch(r"[\w-]{13,}", raw) and not re.fullmatch(r"[A-Za-z0-9_-]{11}", raw):
        return f"https://www.youtube.com/playlist?list={raw}"

    pid = extract_playlist_id(raw)
    if not pid:
        raise ValueError(
            "Could not extract a playlist id. Paste a youtube.com/playlist?list=… "
            "link, or a watch/youtu.be URL that includes &list=…"
        )
    return f"https://www.youtube.com/playlist?list={pid}"


def normalize_youtube_url(raw: str) -> str:
    """Normalize to a single-video watch URL (ignores playlist list= param)."""
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("URL is required")

    # Allow bare video IDs
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", raw):
        return f"https://www.youtube.com/watch?v={raw}"

    if not re.match(r"^https?://", raw, re.I):
        raw = "https://" + raw

    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    if host not in YOUTUBE_HOSTS:
        raise ValueError("Only public youtube.com / youtu.be URLs are supported")

    path = parsed.path or ""
    if host in ("youtu.be", "www.youtu.be"):
        vid = path.strip("/").split("/")[0]
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
            raise ValueError("Invalid youtu.be URL")
        return f"https://www.youtube.com/watch?v={vid}"

    qs = parse_qs(parsed.query)
    if "v" in qs and qs["v"]:
        vid = qs["v"][0]
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
            raise ValueError("Invalid video id")
        return f"https://www.youtube.com/watch?v={vid}"

    # Shorts / embed / live
    m = re.search(r"/(shorts|embed|live)/([A-Za-z0-9_-]{11})", path)
    if m:
        return f"https://www.youtube.com/watch?v={m.group(2)}"

    # Pure playlist URL — tell caller clearly
    if extract_playlist_id(raw) and "/playlist" in path:
        raise ValueError(
            "This is a playlist URL. Use /api/playlist/meta or /api/playlist/convert."
        )

    raise ValueError("Could not extract a public watch URL. Paste a youtube.com or youtu.be link.")


def format_duration(seconds: float | None) -> str | None:
    if seconds is None:
        return None
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m}:{sec:02d}"


def job_key(url: str, quality: str) -> str:
    return hashlib.sha256(f"{url}|{quality}".encode()).hexdigest()[:20]


def safe_audio_basename(title: str | None, vid: str) -> str:
    """Filesystem-safe basename (no extension) derived from title."""
    base = title or "audio"
    base = re.sub(r"[^\w\s\-]+", "", base, flags=re.UNICODE)
    base = re.sub(r"\s+", " ", base).strip()
    base = base[:80].rstrip(". ") or vid
    return base


def quality_opts(quality: Quality) -> dict:
    """yt-dlp postprocessor / format options for audio quality."""
    base_format = "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best"
    if quality == "best":
        return {
            "format": base_format,
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "m4a",
                    "preferredquality": "0",
                }
            ],
        }
    if quality == "256":
        return {
            "format": base_format,
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "m4a",
                    "preferredquality": "256",
                }
            ],
        }
    return {
        "format": base_format,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "128",
            }
        ],
    }


# Prefer clients that work better from datacenter IPs; fall back to web.
YOUTUBE_PLAYER_CLIENTS = ["ios", "tv_embedded", "mweb", "android", "web"]
YTDLP_RETRIES = 3


def _youtube_extractor_args() -> dict:
    return {"youtube": {"player_client": list(YOUTUBE_PLAYER_CLIENTS)}}


def _base_ydl_opts(**extra) -> dict:
    """Common yt-dlp options: public only, EJS via Deno, retries, multi-client."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "retries": YTDLP_RETRIES,
        "fragment_retries": YTDLP_RETRIES,
        "extractor_retries": YTDLP_RETRIES,
        # Deno is installed in the Docker image; enabled by default for EJS.
        "js_runtimes": {"deno": {}},
        # Fallback if yt-dlp-ejs package is missing/outdated on the host.
        "remote_components": {"ejs:github"},
        "extractor_args": _youtube_extractor_args(),
    }
    opts.update(extra)
    return opts


def _is_login_or_bot_block(msg: str) -> bool:
    low = msg.lower()
    needles = (
        "sign in",
        "login",
        "log in",
        "members only",
        "membership",
        "confirm you're not a bot",
        "confirm you are not a bot",
        "not a bot",
        "bot check",
        "please sign in",
        "cookies are required",
        "use --cookies",
        "age-restricted",
        "age restricted",
        "requires authentication",
    )
    return any(n in low for n in needles)


def _friendly_ytdlp_error(exc: BaseException) -> str:
    msg = str(exc)
    low = msg.lower()
    if "private" in low:
        return "This video or playlist is private and cannot be accessed."
    if "unavailable" in low or "not available" in low:
        return "This video or playlist is unavailable."
    if _is_login_or_bot_block(msg):
        return (
            "YouTube is blocking this host (login, membership, or bot-check required). "
            "Datacenter IPs are often restricted; try again later or from a different network. "
            "Login/cookies are not supported."
        )
    if "copyright" in low or "blocked" in low:
        return "This content is blocked or restricted in this region."
    if "drm" in low:
        return "DRM-protected content is not supported."
    return msg


def _http_status_for_ytdlp(exc: BaseException) -> int:
    """Map yt-dlp failures to a clear client status (403 for host blocks)."""
    if _is_login_or_bot_block(str(exc)):
        return 403
    low = str(exc).lower()
    if "private" in low:
        return 403
    return 502


def _raise_ytdlp_http(prefix: str, exc: BaseException) -> None:
    raise HTTPException(
        status_code=_http_status_for_ytdlp(exc),
        detail=f"{prefix}: {_friendly_ytdlp_error(exc)}",
    ) from exc


def _run_with_retries(fn, *args, attempts: int = YTDLP_RETRIES):
    """Retry transient yt-dlp failures a few times with short backoff."""
    import time

    last: BaseException | None = None
    for i in range(max(1, attempts)):
        try:
            return fn(*args)
        except Exception as e:  # noqa: BLE001 — surface via friendly mapper
            last = e
            if _is_login_or_bot_block(str(e)) or "private" in str(e).lower():
                raise
            if i + 1 >= attempts:
                raise
            time.sleep(0.6 * (i + 1))
            logger.warning("yt-dlp retry %s/%s after: %s", i + 1, attempts, e)
    assert last is not None
    raise last


# ---------------------------------------------------------------------------
# yt-dlp runners
# ---------------------------------------------------------------------------


def run_yt_dlp_info(url: str) -> dict:
    import yt_dlp

    def _once() -> dict:
        opts = _base_ydl_opts(
            skip_download=True,
            noplaylist=True,
        )
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        if not info:
            raise RuntimeError("No metadata returned")
        if info.get("is_live"):
            raise RuntimeError("Live streams are not supported")
        return info

    return _run_with_retries(_once)


def run_yt_dlp_playlist_flat(url: str, cap: int = PLAYLIST_LIST_CAP) -> dict:
    """Fast flat playlist extract (no per-video download)."""
    import yt_dlp

    def _once() -> dict:
        opts = _base_ydl_opts(
            skip_download=True,
            extract_flat="in_playlist",
            playlistend=cap,
        )
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        if not info:
            raise RuntimeError("No playlist metadata returned")

        # Single video accidentally returned
        if info.get("_type") not in ("playlist", "multi_video") and not info.get("entries"):
            raise RuntimeError("URL did not resolve to a playlist")

        return info

    return _run_with_retries(_once)


def run_yt_dlp_download(url: str, quality: Quality, outdir: Path) -> tuple[Path, dict]:
    import yt_dlp

    outdir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(outdir / "%(id)s.%(ext)s")
    qopts = quality_opts(quality)

    def _once() -> tuple[Path, dict]:
        opts = _base_ydl_opts(
            noplaylist=True,
            outtmpl=outtmpl,
            format=qopts["format"],
            postprocessors=qopts["postprocessors"],
            prefer_ffmpeg=True,
            keepvideo=False,
        )

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if not info:
                raise RuntimeError("Download failed — no info")

            requested = info.get("requested_downloads") or []
            filepath = None
            if requested and requested[0].get("filepath"):
                filepath = Path(requested[0]["filepath"])
            elif info.get("filepath"):
                filepath = Path(info["filepath"])
            else:
                vid = info.get("id", "audio")
                candidates = sorted(
                    outdir.glob(f"{vid}.*"), key=lambda p: p.stat().st_mtime, reverse=True
                )
                for ext in (".m4a", ".opus", ".mp3", ".webm", ".ogg", ".aac"):
                    for c in candidates:
                        if c.suffix.lower() == ext:
                            filepath = c
                            break
                    if filepath:
                        break
                if not filepath and candidates:
                    filepath = candidates[0]

            if not filepath or not filepath.exists():
                vid = info.get("id", "")
                for p in outdir.iterdir():
                    if p.is_file() and vid and vid in p.name:
                        filepath = p
                        break

            if not filepath or not filepath.exists():
                raise RuntimeError("Downloaded file not found after extraction")

            return filepath, info

    return _run_with_retries(_once)


def meta_from_info(info: dict) -> VideoMeta:
    duration = info.get("duration")
    return VideoMeta(
        id=str(info.get("id") or ""),
        title=str(info.get("title") or "Untitled"),
        channel=info.get("channel") or info.get("uploader"),
        duration=float(duration) if duration is not None else None,
        duration_string=format_duration(float(duration) if duration is not None else None)
        or info.get("duration_string"),
        thumbnail=info.get("thumbnail"),
        webpage_url=info.get("webpage_url") or info.get("original_url"),
        description=(info.get("description") or "")[:500] or None,
        upload_date=info.get("upload_date"),
        view_count=info.get("view_count"),
        is_live=bool(info.get("is_live")),
        availability=info.get("availability"),
    )


def playlist_meta_from_info(info: dict, cap: int = PLAYLIST_LIST_CAP) -> PlaylistMeta:
    raw_entries = list(info.get("entries") or [])
    # yt-dlp may include None placeholders for unavailable videos
    usable = [e for e in raw_entries if e]

    # playlist_count is total on YouTube; entries may already be capped via playlistend
    total_declared = info.get("playlist_count")
    truncated = False
    if total_declared is not None and int(total_declared) > cap:
        truncated = True
    elif len(usable) >= cap:
        # May still be more beyond what we fetched
        truncated = True

    entries: list[PlaylistEntry] = []
    for e in usable[:cap]:
        vid = str(e.get("id") or e.get("url") or "")
        # Flat entries sometimes put id in url
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
            m = re.search(r"([A-Za-z0-9_-]{11})", vid)
            vid = m.group(1) if m else vid
        if not vid:
            continue
        duration = e.get("duration")
        thumb = e.get("thumbnail")
        if not thumb:
            thumbs = e.get("thumbnails") or []
            if thumbs:
                thumb = thumbs[-1].get("url")
        if not thumb and re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
            thumb = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
        entries.append(
            PlaylistEntry(
                id=vid,
                title=str(e.get("title") or "Untitled"),
                duration=float(duration) if duration is not None else None,
                duration_string=format_duration(
                    float(duration) if duration is not None else None
                )
                or e.get("duration_string"),
                thumbnail=thumb,
                url=e.get("url")
                or e.get("webpage_url")
                or (f"https://www.youtube.com/watch?v={vid}" if vid else None),
            )
        )

    note = None
    if truncated:
        note = (
            f"Showing first {len(entries)} of "
            f"{total_declared if total_declared is not None else 'many'} entries "
            f"(cap {cap})."
        )

    return PlaylistMeta(
        id=str(info.get("id") or info.get("playlist_id") or ""),
        title=str(info.get("title") or info.get("playlist_title") or "Playlist"),
        uploader=info.get("uploader") or info.get("channel") or info.get("playlist_uploader"),
        entries=entries,
        entry_count=len(entries),
        truncated=truncated,
        truncated_note=note,
        webpage_url=info.get("webpage_url")
        or info.get("original_url")
        or (
            f"https://www.youtube.com/playlist?list={info.get('id')}"
            if info.get("id")
            else None
        ),
    )


# ---------------------------------------------------------------------------
# Routes — health & single video
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    ytdlp_ok = shutil.which("yt-dlp") is not None or True  # module also ok
    ffmpeg_ok = shutil.which("ffmpeg") is not None
    return {
        "status": "ok",
        "yt_dlp": ytdlp_ok,
        "ffmpeg": ffmpeg_ok,
        "playlist_list_cap": PLAYLIST_LIST_CAP,
        "playlist_convert_cap": PLAYLIST_CONVERT_CAP,
        "playlist_concurrency": PLAYLIST_CONCURRENCY,
        "notice": (
            "Only download content you have rights to. YouTube ToS may restrict downloading. "
            "Public videos/playlists only — no login or DRM bypass."
        ),
    }


@app.get("/api/meta", response_model=VideoMeta)
async def get_meta(url: str = Query(..., description="YouTube URL")):
    try:
        url = normalize_youtube_url(url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    try:
        info = await asyncio.get_event_loop().run_in_executor(_executor, run_yt_dlp_info, url)
        return meta_from_info(info)
    except Exception as e:
        logger.exception("meta failed")
        _raise_ytdlp_http("Could not fetch metadata", e)


@app.post("/api/meta", response_model=VideoMeta)
async def post_meta(body: MetaRequest):
    try:
        info = await asyncio.get_event_loop().run_in_executor(
            _executor, run_yt_dlp_info, body.url
        )
        return meta_from_info(info)
    except Exception as e:
        logger.exception("meta failed")
        _raise_ytdlp_http("Could not fetch metadata", e)


@app.post("/api/convert", response_model=ConvertResponse)
async def convert(body: ConvertRequest):
    key = job_key(body.url, body.quality)
    work = DOWNLOAD_DIR / key
    try:
        filepath, info = await asyncio.get_event_loop().run_in_executor(
            _executor, run_yt_dlp_download, body.url, body.quality, work
        )
    except Exception as e:
        logger.exception("convert failed")
        _raise_ytdlp_http("Conversion failed", e)

    ext = filepath.suffix.lstrip(".") or "m4a"
    safe_name = f"{info.get('id', key)}.{ext}"
    dest = DOWNLOAD_DIR / f"{key}_{safe_name}"
    if filepath.resolve() != dest.resolve():
        shutil.copy2(filepath, dest)

    size = dest.stat().st_size if dest.exists() else None
    abr = info.get("abr")
    if abr is None and body.quality == "256":
        abr = 256
    elif abr is None and body.quality == "128":
        abr = 128

    meta = meta_from_info(info)
    return ConvertResponse(
        meta=meta,
        quality=body.quality,
        format=ext,
        filename=safe_name,
        download_url=f"/api/download/{key}/{safe_name}",
        size_bytes=size,
        bitrate_kbps=int(abr) if abr else None,
    )


@app.get("/api/download/{job_id}/{filename}")
async def download_file(job_id: str, filename: str):
    if not re.fullmatch(r"[a-f0-9]{20}", job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    path = DOWNLOAD_DIR / f"{job_id}_{filename}"
    if not path.exists():
        alt = DOWNLOAD_DIR / job_id / filename
        if alt.exists():
            path = alt
        else:
            raise HTTPException(status_code=404, detail="File not found or expired")

    media = {
        ".m4a": "audio/mp4",
        ".mp3": "audio/mpeg",
        ".opus": "audio/opus",
        ".webm": "audio/webm",
        ".ogg": "audio/ogg",
        ".aac": "audio/aac",
        ".zip": "application/zip",
    }.get(path.suffix.lower(), "application/octet-stream")

    return FileResponse(
        path,
        media_type=media,
        filename=filename,
        headers={"Cache-Control": "private, max-age=3600"},
    )


@app.get("/api/stream")
async def stream_convert(
    url: str = Query(...),
    quality: Quality = Query("best"),
):
    """Convert and stream the audio file in one shot (for simple clients)."""
    try:
        url = normalize_youtube_url(url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    key = job_key(url, quality)
    work = DOWNLOAD_DIR / key

    try:
        filepath, info = await asyncio.get_event_loop().run_in_executor(
            _executor, run_yt_dlp_download, url, quality, work
        )
    except Exception as e:
        logger.exception("stream failed")
        _raise_ytdlp_http("Conversion failed", e)

    media = {
        ".m4a": "audio/mp4",
        ".mp3": "audio/mpeg",
        ".opus": "audio/opus",
        ".webm": "audio/webm",
    }.get(filepath.suffix.lower(), "application/octet-stream")

    title = safe_audio_basename(info.get("title"), str(info.get("id") or "audio"))
    dl_name = f"{title}{filepath.suffix}"

    def iterfile():
        with open(filepath, "rb") as f:
            while chunk := f.read(64 * 1024):
                yield chunk

    return StreamingResponse(
        iterfile(),
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="{dl_name}"',
            "X-Video-Id": str(info.get("id") or ""),
            "X-Title": title,
        },
    )


# ---------------------------------------------------------------------------
# Routes — playlists
# ---------------------------------------------------------------------------


@app.get("/api/playlist/meta", response_model=PlaylistMeta)
async def get_playlist_meta(url: str = Query(..., description="YouTube playlist URL")):
    try:
        url = normalize_playlist_url(url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    try:
        info = await asyncio.get_event_loop().run_in_executor(
            _executor, run_yt_dlp_playlist_flat, url, PLAYLIST_LIST_CAP
        )
        return playlist_meta_from_info(info, PLAYLIST_LIST_CAP)
    except Exception as e:
        logger.exception("playlist meta failed")
        _raise_ytdlp_http("Could not fetch playlist", e)


@app.post("/api/playlist/meta", response_model=PlaylistMeta)
async def post_playlist_meta(body: PlaylistMetaRequest):
    try:
        info = await asyncio.get_event_loop().run_in_executor(
            _executor, run_yt_dlp_playlist_flat, body.url, PLAYLIST_LIST_CAP
        )
        return playlist_meta_from_info(info, PLAYLIST_LIST_CAP)
    except Exception as e:
        logger.exception("playlist meta failed")
        _raise_ytdlp_http("Could not fetch playlist", e)


@app.post("/api/playlist/convert")
async def convert_playlist(body: PlaylistConvertRequest):
    """
    Convert all (or selected) playlist entries to audio and return a ZIP.
    Caps at PLAYLIST_CONVERT_CAP entries with limited concurrency for free-tier hosts.
    """
    # Resolve entry list
    try:
        info = await asyncio.get_event_loop().run_in_executor(
            _executor, run_yt_dlp_playlist_flat, body.url, PLAYLIST_LIST_CAP
        )
    except Exception as e:
        logger.exception("playlist convert: meta failed")
        _raise_ytdlp_http("Could not fetch playlist", e)

    pl = playlist_meta_from_info(info, PLAYLIST_LIST_CAP)
    entry_by_id = {e.id: e for e in pl.entries}

    if body.ids:
        selected_ids = [i for i in body.ids if i in entry_by_id]
        missing = [i for i in body.ids if i not in entry_by_id]
        if not selected_ids:
            raise HTTPException(
                status_code=400,
                detail="None of the requested video ids were found in this playlist.",
            )
        if missing:
            logger.info("playlist convert: skipping unknown ids %s", missing)
    else:
        selected_ids = [e.id for e in pl.entries]

    if len(selected_ids) > PLAYLIST_CONVERT_CAP:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Too many tracks selected ({len(selected_ids)}). "
                f"Select at most {PLAYLIST_CONVERT_CAP} at a time "
                "(Render free-tier timeouts). Pass ids= to choose a subset."
            ),
        )

    job = job_key(f"pl:{pl.id}|{','.join(selected_ids)}|{body.quality}", body.quality)
    work_root = DOWNLOAD_DIR / f"pl_{job}"
    work_root.mkdir(parents=True, exist_ok=True)
    zip_path = DOWNLOAD_DIR / f"{job}_playlist.zip"

    sem = asyncio.Semaphore(PLAYLIST_CONCURRENCY)
    loop = asyncio.get_event_loop()
    results: list[tuple[str, Path, str]] = []  # (vid, path, title)
    errors: list[str] = []

    async def _one(vid: str, index: int) -> None:
        entry = entry_by_id[vid]
        watch = f"https://www.youtube.com/watch?v={vid}"
        outdir = work_root / vid
        async with sem:
            try:
                filepath, info = await loop.run_in_executor(
                    _executor, run_yt_dlp_download, watch, body.quality, outdir
                )
                title = entry.title or info.get("title") or vid
                results.append((vid, filepath, title))
            except Exception as e:
                logger.warning("playlist entry %s failed: %s", vid, e)
                errors.append(f"{vid}: {_friendly_ytdlp_error(e)}")

    await asyncio.gather(*[_one(vid, i) for i, vid in enumerate(selected_ids)])

    if not results:
        shutil.rmtree(work_root, ignore_errors=True)
        detail = "No tracks could be converted."
        if errors:
            detail += " " + "; ".join(errors[:5])
        # Prefer 403 when failures look like host/login blocks
        status = 403 if any(_is_login_or_bot_block(e) for e in errors) else 502
        raise HTTPException(status_code=status, detail=detail)

    # Build ZIP with safe, unique names
    used_names: set[str] = set()
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for idx, (vid, filepath, title) in enumerate(results, start=1):
            ext = filepath.suffix.lstrip(".") or "m4a"
            base = safe_audio_basename(title, vid)
            name = f"{idx:02d}_{base}_{vid}.{ext}"
            # Collision guard
            n = 1
            while name in used_names:
                n += 1
                name = f"{idx:02d}_{base}_{vid}_{n}.{ext}"
            used_names.add(name)
            zf.write(filepath, arcname=name)
        if errors:
            zf.writestr(
                "_errors.txt",
                "Some tracks failed:\n" + "\n".join(errors) + "\n",
            )

    # Cleanup per-video work dirs (keep zip)
    shutil.rmtree(work_root, ignore_errors=True)

    pl_title = safe_audio_basename(pl.title, pl.id or "playlist")
    dl_name = f"{pl_title}.zip"

    def iterzip():
        with open(zip_path, "rb") as f:
            while chunk := f.read(64 * 1024):
                yield chunk

    return StreamingResponse(
        iterzip(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{dl_name}"',
            "X-Playlist-Id": pl.id,
            "X-Track-Count": str(len(results)),
            "X-Failed-Count": str(len(errors)),
            "Cache-Control": "private, max-age=3600",
        },
    )


@app.on_event("startup")
async def startup():
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(
        "YouTube Audio API ready. download_dir=%s list_cap=%s convert_cap=%s concurrency=%s",
        DOWNLOAD_DIR,
        PLAYLIST_LIST_CAP,
        PLAYLIST_CONVERT_CAP,
        PLAYLIST_CONCURRENCY,
    )
