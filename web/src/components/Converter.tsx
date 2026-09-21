"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ConvertResponse,
  Quality,
  VideoMeta,
  absoluteDownloadUrl,
  convertAudio,
  fetchMeta,
  looksLikeYoutubeUrl,
} from "../lib/api";
import { formatBytes, formatViews } from "../lib/format";
import EthicsNotice from "./EthicsNotice";

const QUALITIES: { id: Quality; label: string; hint: string }[] = [
  { id: "best", label: "Best", hint: "m4a / highest available" },
  { id: "256", label: "256 kbps", hint: "AAC m4a" },
  { id: "128", label: "128 kbps", hint: "MP3" },
];

type Stage = "idle" | "meta" | "ready" | "converting" | "done" | "error";

export default function Converter({ initialUrl = "" }: { initialUrl?: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [quality, setQuality] = useState<Quality>("best");
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [result, setResult] = useState<ConvertResponse | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const canPreview = useMemo(() => looksLikeYoutubeUrl(url), [url]);

  const loadMeta = useCallback(async (u: string) => {
    if (!looksLikeYoutubeUrl(u)) return;
    setStage("meta");
    setError(null);
    setResult(null);
    setMeta(null);
    setProgress(12);
    try {
      const m = await fetchMeta(u.trim());
      setMeta(m);
      setStage("ready");
      setProgress(0);
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

  // Fake progress while converting (yt-dlp doesn't stream % easily)
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

  async function onConvert() {
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

  function onDownload() {
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
              placeholder="https://www.youtube.com/watch?v=… or youtu.be/…"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setStage("idle");
                setError(null);
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
            <span>{stage === "meta" ? "Fetching metadata…" : "Extracting audio…"}</span>
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
          {error}
        </div>
      )}

      {meta && (
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
                    disabled={stage === "converting"}
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

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={onConvert}
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
                  onClick={onDownload}
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

      <EthicsNotice />
    </div>
  );
}
