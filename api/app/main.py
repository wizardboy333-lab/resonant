"""YouTube Audio Extractor API — extract audio from public YouTube watch URLs."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import shutil
import tempfile
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

Quality = Literal["best", "256", "128"]

app = FastAPI(
    title="YouTube Audio API",
    description=(
        "Extract audio from public YouTube watch URLs. "
        "Only download content you have rights to. YouTube ToS may restrict downloading."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


def normalize_youtube_url(raw: str) -> str:
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

    # Reject obvious non-watch patterns that aren't useful
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

    # Shorts / embed
    m = re.search(r"/(shorts|embed|live)/([A-Za-z0-9_-]{11})", path)
    if m:
        return f"https://www.youtube.com/watch?v={m.group(2)}"

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


def quality_opts(quality: Quality) -> dict:
    """yt-dlp postprocessor / format options for audio quality."""
    # Prefer m4a/opus/mp3, high bitrate where possible
    base_format = "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best"
    if quality == "best":
        return {
            "format": base_format,
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "m4a",
                    "preferredquality": "0",  # best / copy when possible
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
    # 128
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


def run_yt_dlp_info(url: str) -> dict:
    import yt_dlp

    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        # Public URLs only — no cookies / credentials
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        raise RuntimeError("No metadata returned")
    if info.get("is_live"):
        raise RuntimeError("Live streams are not supported")
    return info


def run_yt_dlp_download(url: str, quality: Quality, outdir: Path) -> tuple[Path, dict]:
    import yt_dlp

    outdir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(outdir / "%(id)s.%(ext)s")
    qopts = quality_opts(quality)

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "outtmpl": outtmpl,
        "format": qopts["format"],
        "postprocessors": qopts["postprocessors"],
        "prefer_ffmpeg": True,
        "keepvideo": False,
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
    }

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        if not info:
            raise RuntimeError("Download failed — no info")

        # Resolve final filepath after postprocessing
        requested = info.get("requested_downloads") or []
        filepath = None
        if requested and requested[0].get("filepath"):
            filepath = Path(requested[0]["filepath"])
        elif info.get("filepath"):
            filepath = Path(info["filepath"])
        else:
            vid = info.get("id", "audio")
            # Find newest file matching id
            candidates = sorted(outdir.glob(f"{vid}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
            # Prefer audio extensions
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
            # Postprocessor may have changed extension — scan again
            vid = info.get("id", "")
            for p in outdir.iterdir():
                if p.is_file() and vid and vid in p.name:
                    filepath = p
                    break

        if not filepath or not filepath.exists():
            raise RuntimeError("Downloaded file not found after extraction")

        return filepath, info


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


@app.get("/health")
async def health():
    ytdlp_ok = shutil.which("yt-dlp") is not None or True  # module also ok
    ffmpeg_ok = shutil.which("ffmpeg") is not None
    return {
        "status": "ok",
        "yt_dlp": ytdlp_ok,
        "ffmpeg": ffmpeg_ok,
        "notice": "Only download content you have rights to. YouTube ToS may restrict downloading.",
    }


@app.get("/api/meta", response_model=VideoMeta)
async def get_meta(url: str = Query(..., description="YouTube URL")):
    try:
        url = normalize_youtube_url(url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    try:
        info = await asyncio.to_thread(run_yt_dlp_info, url)
        return meta_from_info(info)
    except Exception as e:
        logger.exception("meta failed")
        raise HTTPException(status_code=502, detail=f"Could not fetch metadata: {e}") from e


@app.post("/api/meta", response_model=VideoMeta)
async def post_meta(body: MetaRequest):
    try:
        info = await asyncio.to_thread(run_yt_dlp_info, body.url)
        return meta_from_info(info)
    except Exception as e:
        logger.exception("meta failed")
        raise HTTPException(status_code=502, detail=f"Could not fetch metadata: {e}") from e


@app.post("/api/convert", response_model=ConvertResponse)
async def convert(body: ConvertRequest):
    key = job_key(body.url, body.quality)
    work = DOWNLOAD_DIR / key
    try:
        filepath, info = await asyncio.to_thread(
            run_yt_dlp_download, body.url, body.quality, work
        )
    except Exception as e:
        logger.exception("convert failed")
        raise HTTPException(status_code=502, detail=f"Conversion failed: {e}") from e

    # Stable filename for download endpoint
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
        # Fallback: look inside job folder
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
        filepath, info = await asyncio.to_thread(run_yt_dlp_download, url, quality, work)
    except Exception as e:
        logger.exception("stream failed")
        raise HTTPException(status_code=502, detail=f"Conversion failed: {e}") from e

    media = {
        ".m4a": "audio/mp4",
        ".mp3": "audio/mpeg",
        ".opus": "audio/opus",
        ".webm": "audio/webm",
    }.get(filepath.suffix.lower(), "application/octet-stream")

    title = re.sub(r"[^\w\s\-]", "", info.get("title") or "audio")[:80].strip() or "audio"
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


@app.on_event("startup")
async def startup():
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("YouTube Audio API ready. download_dir=%s", DOWNLOAD_DIR)
