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
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  try {
    // Clone so we can fall back to text if JSON parse fails on HTML error pages
    const raw = await res.clone().text();
    const looksHtml =
      ct.includes("text/html") ||
      /^\s*<(!DOCTYPE|html|head|body|title|cf-|center)/i.test(raw);

    if (!looksHtml) {
      try {
        const data = JSON.parse(raw);
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
      } catch {
        /* fall through */
      }
    }

    if (looksHtml) {
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        return `${statusPrefix}: upstream unavailable (try again, or paste a single video URL)`;
      }
      return `${statusPrefix}: unexpected HTML error page from proxy/upstream`;
    }

    const trimmed = raw.trim();
    if (trimmed) {
      return trimmed.length > 280 ? `${statusPrefix}: ${trimmed.slice(0, 280)}…` : trimmed;
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

/** Extract an 11-char YouTube video id from a watch / youtu.be / shorts URL, or bare id. */
export function extractVideoId(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  try {
    const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    const u = new URL(withProto);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com")) {
      const vParam = u.searchParams.get("v");
      if (vParam && /^[A-Za-z0-9_-]{11}$/.test(vParam)) return vParam;
      const m = u.pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {
    /* ignore */
  }
  const m =
    /(?:v=|youtu\.be\/|\/(?:shorts|embed|live)\/)([A-Za-z0-9_-]{11})/i.exec(v);
  return m ? m[1] : null;
}

/** Keep only the canonical single-video watch URL when a video id is present. */
export function stripToWatchUrl(url: string): string | null {
  const id = extractVideoId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

function isMixOrRadioList(listId: string | null): boolean {
  if (!listId) return false;
  // Mix/Radio: RD… (including RD followed by a video id), or explicit start_radio
  return /^RD/i.test(listId);
}

/** Detect real playlist URLs. Mix/Radio watch shares with a video id are NOT playlists. */
export function looksLikePlaylistUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;

  // Bare playlist-ish ids (longer than a video id)
  if (/^(PL|UU|LL|FL|OL|RD|SE)[\w-]{10,}$/i.test(v)) return true;
  if (/youtube\.com\/playlist/i.test(v)) return true;

  let listId: string | null = null;
  let startRadio = false;
  try {
    const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    const u = new URL(withProto);
    listId = u.searchParams.get("list");
    startRadio =
      u.searchParams.get("start_radio") === "1" ||
      u.searchParams.has("start_radio");
  } catch {
    const lm = /[?&]list=([^&]+)/i.exec(v);
    listId = lm ? decodeURIComponent(lm[1]) : null;
    startRadio = /[?&]start_radio=1\b/i.test(v);
  }

  if (!listId && !/[?&]list=/i.test(v)) return false;

  const videoId = extractVideoId(v);
  // Watch / youtu.be URL with a concrete video + Mix/Radio → treat as single video
  if (videoId && (isMixOrRadioList(listId) || startRadio)) {
    return false;
  }

  return true;
}
