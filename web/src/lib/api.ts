export type Quality = "best" | "256" | "128";

export interface VideoMeta {
  id: string;
  title: string;
  channel: string | null;
  duration: number | null;
  duration_string: string | null;
  thumbnail: string | null;
  webpage_url: string | null;
  description: string | null;
  upload_date: string | null;
  view_count: number | null;
  is_live: boolean | null;
  availability: string | null;
}

export interface ConvertResponse {
  meta: VideoMeta;
  quality: string;
  format: string;
  filename: string;
  download_url: string;
  size_bytes: number | null;
  bitrate_kbps: number | null;
}

export interface PlaylistEntry {
  id: string;
  title: string;
  duration: number | null;
  duration_string: string | null;
  thumbnail: string | null;
  url: string | null;
}

export interface PlaylistMeta {
  id: string;
  title: string;
  uploader: string | null;
  entries: PlaylistEntry[];
  entry_count: number;
  truncated: boolean;
  truncated_note: string | null;
  webpage_url: string | null;
}

/** Browser: same-origin proxy so phones can reach the API. Server: internal URL. */
function apiBase(): string {
  if (typeof window !== "undefined") {
    return "/api-proxy";
  }
  return (
    process.env.API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://127.0.0.1:8000"
  );
}

export function absoluteDownloadUrl(path: string): string {
  if (path.startsWith("http")) return path;
  // Relative API paths (e.g. /api/download/...) must go through the proxy in the browser
  if (typeof window !== "undefined" && path.startsWith("/")) {
    return `/api-proxy${path}`;
  }
  return `${apiBase()}${path}`;
}

async function parseError(res: Response): Promise<string> {
  const statusPrefix = `HTTP ${res.status}`;
  try {
    const data = await res.json();
    if (typeof data?.detail === "string" && data.detail.trim()) {
      return data.detail;
    }
    if (Array.isArray(data?.detail)) {
      const joined = data.detail
        .map((d: { msg?: string }) => d.msg)
        .filter(Boolean)
        .join("; ");
      if (joined) return joined;
    }
    if (data && typeof data === "object") {
      return `${statusPrefix}: ${JSON.stringify(data)}`;
    }
    return res.statusText ? `${statusPrefix}: ${res.statusText}` : statusPrefix;
  } catch {
    return res.statusText ? `${statusPrefix}: ${res.statusText}` : statusPrefix;
  }
}

export async function fetchMeta(url: string): Promise<VideoMeta> {
  const res = await fetch(
    `${apiBase()}/api/meta?url=${encodeURIComponent(url)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchPlaylistMeta(url: string): Promise<PlaylistMeta> {
  const res = await fetch(
    `${apiBase()}/api/playlist/meta?url=${encodeURIComponent(url)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function convertAudio(
  url: string,
  quality: Quality
): Promise<ConvertResponse> {
  const res = await fetch(`${apiBase()}/api/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, quality }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

/** Convert playlist tracks to a ZIP blob (all or selected ids). */
export async function convertPlaylistZip(
  url: string,
  quality: Quality,
  ids?: string[]
): Promise<{ blob: Blob; filename: string; trackCount: number; failedCount: number }> {
  const res = await fetch(`${apiBase()}/api/playlist/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, quality, ids: ids ?? null }),
  });
  if (!res.ok) throw new Error(await parseError(res));

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] || "playlist.zip";
  const trackCount = Number(res.headers.get("X-Track-Count") || "0");
  const failedCount = Number(res.headers.get("X-Failed-Count") || "0");
  return { blob, filename, trackCount, failedCount };
}

export function looksLikeYoutubeUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return true;
  return /youtu\.?be|youtube\.com/i.test(v);
}

/** Detect playlist URLs: /playlist?list=, watch/youtu.be with list=, bare PL… ids. */
export function looksLikePlaylistUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/[?&]list=/i.test(v)) return true;
  if (/youtube\.com\/playlist/i.test(v)) return true;
  // Bare playlist-ish ids (longer than a video id)
  if (/^(PL|UU|LL|FL|OL|RD|SE)[\w-]{10,}$/i.test(v)) return true;
  return false;
}
