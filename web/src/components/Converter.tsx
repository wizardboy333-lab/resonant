"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ConvertResponse,
  PlaylistMeta,
  Quality,
  VideoMeta,
  absoluteDownloadUrl,
  convertAudio,
  convertPlaylistZip,
  extractVideoId,
  fetchMeta,
  fetchPlaylistMeta,
  looksLikePlaylistUrl,
  looksLikeYoutubeUrl,
  stripToWatchUrl,
} from "../lib/api";
import { formatBytes, formatViews } from "../lib/format";
import EthicsNotice from "./EthicsNotice";

const QUALITIES: { id: Quality; label: string; hint: string }[] = [
  { id: "best", label: "Best", hint: "m4a / highest available" },
  { id: "256", label: "256 kbps", hint: "AAC m4a" },
  { id: "128", label: "128 kbps", hint: "MP3" },
];

/** Soft client-side cap matching API PLAYLIST_CONVERT_CAP default */
const CLIENT_CONVERT_CAP = 30;

type Stage =
  | "idle"
  | "meta"
  | "ready"
  | "converting"
  | "done"
  | "error";

type Mode = "video" | "playlist";

export default function Converter({ initialUrl = "" }: { initialUrl?: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [quality, setQuality] = useState<Quality>("best");
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistMeta | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ConvertResponse | null>(null);
  const [zipInfo, setZipInfo] = useState<{
    filename: string;
    trackCount: number;
    failedCount: number;
    sizeBytes: number;
  } | null>(null);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [mode, setMode] = useState<Mode>("video");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const canPreview = useMemo(() => looksLikeYoutubeUrl(url), [url]);

  const allSelected =
    !!playlist &&
    playlist.entries.length > 0 &&
    playlist.entries.every((e) => selected.has(e.id));

  const selectedCount = selected.size;

  const resetPreview = () => {
    setMeta(null);
    setPlaylist(null);
    setSelected(new Set());
    setResult(null);
    setZipInfo(null);
    if (zipUrl) {
      URL.revokeObjectURL(zipUrl);
      setZipUrl(null);
    }
  };

  const loadMeta = useCallback(async (u: string) => {
    if (!looksLikeYoutubeUrl(u)) return;
    setStage("meta");
    setError(null);
    setResult(null);
    setZipInfo(null);
    setMeta(null);
    setPlaylist(null);
    setSelected(new Set());
    setProgress(12);

    const trimmed = u.trim();
    try {
      if (looksLikePlaylistUrl(trimmed)) {
        try {
          const pl = await fetchPlaylistMeta(trimmed);
          setPlaylist(pl);
          setSelected(new Set(pl.entries.map((e) => e.id)));
          setMode("playlist");
          setStage("ready");
          setProgress(0);
          return;
        } catch (playlistErr) {
          // Defense in depth: Mix/Radio (or other unviewable lists) with a video id → video meta
          const watch = stripToWatchUrl(trimmed);
          if (watch && extractVideoId(trimmed)) {
            const m = await fetchMeta(watch);
            setMeta(m);
            setMode("video");
            setStage("ready");
            setProgress(0);
            return;
          }
          throw playlistErr;
        }
      } else {
        const watch = stripToWatchUrl(trimmed) || trimmed;
        const m = await fetchMeta(watch);
        setMeta(m);
        setMode("video");
        setStage("ready");
        setProgress(0);
      }
    } catch (e) {
      setStage("error");
      setError(e instanceof Error ? e.message : "Failed to load metadata");
      setProgress(0);
    }
  }, []);

  useEffect(() => {
    if (initialUrl && looksLikeYoutubeUrl(initialUrl)) {
      void loadMeta(initialUrl);
    }
  }, [initialUrl, loadMeta]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (zipUrl) URL.revokeObjectURL(zipUrl);
    };
  }, [zipUrl]);

  // Fake progress while converting
  useEffect(() => {
    if (stage !== "converting") return;
    setProgress(8);
    const t = setInterval(() => {
      setProgress((p) => {
        if (p >= 92) return p;
        const step = p < 40 ? 4 : p < 70 ? 2.5 : 1;
        return Math.min(92, p + step);
      });
    }, 400);
    return () => clearInterval(t);
  }, [stage]);

  async function onPreview(e: React.FormEvent) {
    e.preventDefault();
    await loadMeta(url);
  }

  function toggleAll() {
    if (!playlist) return;
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(playlist.entries.map((e) => e.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onConvertVideo() {
    if (!url.trim()) return;
    setStage("converting");
    setError(null);
    setResult(null);
    try {
      const r = await convertAudio(url.trim(), quality);
      setResult(r);
      setMeta(r.meta);
      setProgress(100);
      setStage("done");
    } catch (e) {
      setStage("error");
      setError(e instanceof Error ? e.message : "Conversion failed");
      setProgress(0);
    }
  }

  async function onConvertPlaylist(ids: string[] | "all") {
    if (!url.trim() || !playlist) return;
    const chosen =
      ids === "all" ? playlist.entries.map((e) => e.id) : ids;

    if (chosen.length === 0) {
      setError("Select at least one track.");
      setStage("error");
      return;
    }
    if (chosen.length > CLIENT_CONVERT_CAP) {
      setError(
        `Select at most ${CLIENT_CONVERT_CAP} tracks at a time (host timeout limits).`
      );
      setStage("error");
      return;
    }

    setStage("converting");
    setError(null);
    setResult(null);
    setZipInfo(null);
    if (zipUrl) {
      URL.revokeObjectURL(zipUrl);
      setZipUrl(null);
    }

    try {
      const { blob, filename, trackCount, failedCount } = await convertPlaylistZip(
        url.trim(),
        quality,
        chosen
      );
      const objectUrl = URL.createObjectURL(blob);
      setZipUrl(objectUrl);
      setZipInfo({
        filename,
        trackCount,
        failedCount,
        sizeBytes: blob.size,
      });
      setProgress(100);
      setStage("done");
    } catch (e) {
      setStage("error");
      setError(e instanceof Error ? e.message : "Playlist conversion failed");
      setProgress(0);
    }
  }

  function onDownloadVideo() {
    if (!result) return;
    const href = absoluteDownloadUrl(result.download_url);
    const a = document.createElement("a");
    a.href = href;
    a.download = result.filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function onDownloadZip() {
    if (!zipUrl || !zipInfo) return;
    const a = document.createElement("a");
    a.href = zipUrl;
    a.download = zipInfo.filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onPreview} className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-mist-400">
            YouTube URL
          </span>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="Video or playlist — youtube.com / youtu.be / playlist?list=…"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setStage("idle");
                setError(null);
                resetPreview();
              }}
              className="w-full flex-1 rounded-2xl border border-white/10 bg-ink-800/80 px-4 py-3.5 text-base text-mist-100 placeholder:text-mist-500 shadow-inner transition focus:border-ember-400/50 focus:bg-ink-700"
            />
            <button
              type="submit"
              disabled={!canPreview || stage === "meta" || stage === "converting"}
              className="shrink-0 rounded-2xl bg-white/10 px-5 py-3.5 text-sm font-semibold text-mist-100 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {stage === "meta" ? "Loading…" : "Preview"}
            </button>
          </div>
        </label>
      </form>

      {(stage === "meta" || stage === "converting") && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-mist-400">
            <span>
              {stage === "meta"
                ? mode === "playlist" || looksLikePlaylistUrl(url)
                  ? "Fetching playlist…"
                  : "Fetching metadata…"
                : mode === "playlist"
                  ? "Extracting playlist audio…"
                  : "Extracting audio…"}
            </span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-700">
            <div
              className="progress-shimmer h-full animate-shimmer rounded-full transition-all duration-300"
              style={{ width: `${Math.max(progress, 6)}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-red-300/80">
            Error
          </p>
          <p className="whitespace-pre-wrap break-words">{error}</p>
          {isHostBlockError(error) && (
            <p className="mt-2 text-xs text-red-100/80">
              Tip: this host looks blocked by YouTube (login / bot-check). Cookies
              or a different host may help — it is not necessarily a permanent
              outage. See the Render deploy docs for optional cookie setup.
            </p>
          )}
        </div>
      )}

      {/* -------- Single video -------- */}
      {meta && mode === "video" && (
        <article className="overflow-hidden rounded-3xl border border-white/10 bg-ink-800/60 shadow-card">
          <div className="grid gap-0 sm:grid-cols-[minmax(0,220px)_1fr]">
            <div className="relative aspect-video bg-ink-900 sm:aspect-auto sm:min-h-[140px]">
              {meta.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={meta.thumbnail}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full min-h-[140px] items-center justify-center text-mist-500">
                  No thumbnail
                </div>
              )}
              {meta.duration_string && (
                <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 font-mono text-[11px] text-white">
                  {meta.duration_string}
                </span>
              )}
            </div>
            <div className="flex flex-col justify-center gap-2 p-5 sm:p-6">
              <h2 className="font-display text-xl leading-snug text-mist-100 text-balance sm:text-2xl">
                {meta.title}
              </h2>
              <p className="text-sm text-mist-300">
                {meta.channel || "Unknown channel"}
                {meta.view_count != null && (
                  <span className="text-mist-500"> · {formatViews(meta.view_count)}</span>
                )}
              </p>
              {meta.description && (
                <p className="line-clamp-2 text-xs text-mist-500">{meta.description}</p>
              )}
            </div>
          </div>

          <div className="border-t border-white/5 px-5 py-5 sm:px-6">
            <QualityPicker
              quality={quality}
              setQuality={setQuality}
              disabled={stage === "converting"}
            />

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={onConvertVideo}
                disabled={stage === "converting" || stage === "meta"}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-ember-500 to-ember-600 px-5 py-3.5 text-sm font-semibold text-ink-950 shadow-glow transition hover:from-ember-400 hover:to-ember-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {stage === "converting" ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950" />
                    Converting…
                  </>
                ) : (
                  <>Extract audio</>
                )}
              </button>

              {result && stage === "done" && (
                <button
                  type="button"
                  onClick={onDownloadVideo}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-viola-400/40 bg-viola-500/15 px-5 py-3.5 text-sm font-semibold text-viola-300 transition hover:bg-viola-500/25"
                >
                  Download {result.format.toUpperCase()}
                  {result.size_bytes != null && (
                    <span className="font-normal text-mist-400">
                      ({formatBytes(result.size_bytes)})
                    </span>
                  )}
                </button>
              )}
            </div>

            {result && stage === "done" && (
              <p className="mt-3 text-xs text-mist-400">
                Ready · {result.format.toUpperCase()}
                {result.bitrate_kbps ? ` · ~${result.bitrate_kbps} kbps` : ""}
                {result.quality ? ` · quality ${result.quality}` : ""}
              </p>
            )}
          </div>
        </article>
      )}

      {/* -------- Playlist -------- */}
      {playlist && mode === "playlist" && (
        <article className="overflow-hidden rounded-3xl border border-white/10 bg-ink-800/60 shadow-card">
          <div className="border-b border-white/5 px-5 py-5 sm:px-6">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.18em] text-ember-300">
              Playlist
            </p>
            <h2 className="font-display text-xl leading-snug text-mist-100 text-balance sm:text-2xl">
              {playlist.title}
            </h2>
            <p className="mt-1 text-sm text-mist-300">
              {playlist.uploader || "Unknown uploader"}
              <span className="text-mist-500">
                {" "}
                · {playlist.entry_count} track
                {playlist.entry_count === 1 ? "" : "s"}
              </span>
            </p>
            {playlist.truncated && playlist.truncated_note && (
              <p className="mt-2 text-xs text-ember-200/80">{playlist.truncated_note}</p>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/5 bg-ink-900/95 px-5 py-3 backdrop-blur sm:px-6">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-mist-200">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={stage === "converting"}
                  className="h-4 w-4 rounded border-white/20 bg-ink-800 text-ember-500 focus:ring-ember-400/40"
                />
                Select all
              </label>
              <span className="text-xs text-mist-400">
                {selectedCount} selected
                {selectedCount > CLIENT_CONVERT_CAP && (
                  <span className="text-red-300">
                    {" "}
                    (max {CLIENT_CONVERT_CAP})
                  </span>
                )}
              </span>
            </div>

            <ul className="divide-y divide-white/5">
              {playlist.entries.map((entry) => {
                const checked = selected.has(entry.id);
                return (
                  <li key={entry.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 px-5 py-3 transition hover:bg-white/[0.03] sm:px-6 ${
                        checked ? "bg-ember-500/5" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(entry.id)}
                        disabled={stage === "converting"}
                        className="h-4 w-4 shrink-0 rounded border-white/20 bg-ink-800 text-ember-500 focus:ring-ember-400/40"
                      />
                      <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-ink-900">
                        {entry.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={entry.thumbnail}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-mist-100">
                          {entry.title}
                        </p>
                        <p className="font-mono text-[11px] text-mist-500">
                          {entry.duration_string || "—"} · {entry.id}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="border-t border-white/5 px-5 py-5 sm:px-6">
            <QualityPicker
              quality={quality}
              setQuality={setQuality}
              disabled={stage === "converting"}
            />

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => onConvertPlaylist(Array.from(selected))}
                disabled={
                  stage === "converting" ||
                  stage === "meta" ||
                  selectedCount === 0 ||
                  selectedCount > CLIENT_CONVERT_CAP
                }
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-ember-500 to-ember-600 px-5 py-3.5 text-sm font-semibold text-ink-950 shadow-glow transition hover:from-ember-400 hover:to-ember-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {stage === "converting" ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950" />
                    Converting…
                  </>
                ) : (
                  <>Download selected ({selectedCount})</>
                )}
              </button>

              <button
                type="button"
                onClick={() => onConvertPlaylist("all")}
                disabled={
                  stage === "converting" ||
                  stage === "meta" ||
                  playlist.entries.length === 0 ||
                  playlist.entries.length > CLIENT_CONVERT_CAP
                }
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-5 py-3.5 text-sm font-semibold text-mist-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Download all
                {playlist.entries.length > CLIENT_CONVERT_CAP
                  ? ` (cap ${CLIENT_CONVERT_CAP})`
                  : ` (${playlist.entries.length})`}
              </button>
            </div>

            {playlist.entries.length > CLIENT_CONVERT_CAP && (
              <p className="mt-3 text-xs text-mist-400">
                Large playlists: convert in batches of {CLIENT_CONVERT_CAP} or fewer
                (Render free-tier request timeouts).
              </p>
            )}

            {zipInfo && stage === "done" && zipUrl && (
              <div className="mt-4 space-y-3">
                <button
                  type="button"
                  onClick={onDownloadZip}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-viola-400/40 bg-viola-500/15 px-5 py-3.5 text-sm font-semibold text-viola-300 transition hover:bg-viola-500/25"
                >
                  Download ZIP
                  <span className="font-normal text-mist-400">
                    ({formatBytes(zipInfo.sizeBytes)})
                  </span>
                </button>
                <p className="text-xs text-mist-400">
                  Ready · {zipInfo.trackCount} track
                  {zipInfo.trackCount === 1 ? "" : "s"} in {zipInfo.filename}
                  {zipInfo.failedCount > 0 && (
                    <span className="text-ember-200">
                      {" "}
                      · {zipInfo.failedCount} failed (see _errors.txt in ZIP)
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        </article>
      )}

      <EthicsNotice />
    </div>
  );
}


function isHostBlockError(message: string): boolean {
  const low = message.toLowerCase();
  return (
    low.includes("blocking this host") ||
    low.includes("bot-check") ||
    low.includes("bot check") ||
    low.includes("sign in") ||
    low.includes("login") ||
    low.includes("log in") ||
    low.includes("cookies") ||
    low.includes("membership") ||
    low.includes("age-restricted") ||
    low.includes("age restricted")
  );
}

function QualityPicker({
  quality,
  setQuality,
  disabled,
}: {
  quality: Quality;
  setQuality: (q: Quality) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-mist-400">
        Quality
      </p>
      <div className="grid grid-cols-3 gap-2">
        {QUALITIES.map((q) => {
          const active = quality === q.id;
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => setQuality(q.id)}
              disabled={disabled}
              className={`rounded-2xl border px-3 py-3 text-left transition ${
                active
                  ? "border-ember-400/60 bg-ember-500/15 shadow-glow"
                  : "border-white/10 bg-ink-900/50 hover:border-white/20"
              }`}
            >
              <span className="block text-sm font-semibold text-mist-100">
                {q.label}
              </span>
              <span className="mt-0.5 block text-[11px] text-mist-400">{q.hint}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
