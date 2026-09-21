import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function apiBase(): string {
  return (
    process.env.API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://127.0.0.1:8000"
  ).replace(/\/$/, "");
}

async function proxy(
  req: NextRequest,
  context: { params: { path: string[] } }
): Promise<NextResponse> {
  const segments = context.params.path ?? [];
  const path = segments.map(encodeURIComponent).join("/");
  const target = `${apiBase()}/${path}${req.nextUrl.search}`;

  const headers = new Headers();
  const forward = ["content-type", "accept", "authorization", "cookie", "range"];
  for (const name of forward) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };

  if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
    init.body = req.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream fetch failed";
    return NextResponse.json(
      { detail: `API proxy error: ${message}` },
      { status: 502 }
    );
  }

  const outHeaders = new Headers();
  const pass = [
    "content-type",
    "content-disposition",
    "content-length",
    "content-range",
    "accept-ranges",
    "cache-control",
    "etag",
    "last-modified",
  ];
  for (const name of pass) {
    const value = upstream.headers.get(name);
    if (value) outHeaders.set(name, value);
  }

  // Stream body through (important for /api/download/* audio files)
  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const PATCH = proxy;
