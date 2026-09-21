# Deno binary for yt-dlp EJS (YouTube JS challenges). Multi-stage keeps the
# final image lean vs installing via curl install script.
FROM denoland/deno:bin AS deno-bin

FROM python:3.12-slim

COPY --from=deno-bin /deno /usr/local/bin/deno

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# yt-dlp[default] pulls yt-dlp-ejs (challenge solver scripts). Deno is on PATH
# and enabled by default for EJS; keep image reasonable for Render free.
RUN pip install --no-cache-dir -U pip \
    && pip install --no-cache-dir -r requirements.txt \
    && deno --version \
    && yt-dlp --version \
    && python -c "import yt_dlp_ejs; print('yt-dlp-ejs ok')"

COPY app ./app
RUN mkdir -p /tmp/ytaudio

ENV DOWNLOAD_DIR=/tmp/ytaudio
ENV PORT=8000
# Deno cache dir for EJS / npm fetches (writable in container)
ENV DENO_DIR=/tmp/deno
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
