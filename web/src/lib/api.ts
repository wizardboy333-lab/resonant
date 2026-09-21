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
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail)) {
      return data.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join("; ");
    }
    return JSON.stringify(data);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
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

export function looksLikeYoutubeUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return true;
  return /youtu\.?be|youtube\.com/i.test(v);
}
