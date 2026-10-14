import { NextResponse } from "next/server";

/**
 * Image proxy for third-party logos. Browsers in some regions cannot reach
 * polymarket.com hosts at all (ISP DNS blocks), while our server can, so
 * logos are fetched here and cached at the edge for a week.
 */

const ALLOWED_HOSTS = new Set([
  "assets.perpetuals.polymarket.com",
  "polymarket-upload.s3.us-east-2.amazonaws.com",
  "assets.coingecko.com",
  "coin-images.coingecko.com",
]);
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export const runtime = "nodejs";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("u");
  if (!raw) return NextResponse.json({ message: "Missing u" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ message: "Invalid url" }, { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
    return NextResponse.json({ message: "Host not allowed" }, { status: 400 });
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        accept: "image/*,*/*;q=0.8",
        origin: "https://polymarket.com",
        referer: "https://polymarket.com/",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "force-cache",
      next: { revalidate: 7 * 24 * 3600 },
    });
    if (!upstream.ok) {
      return new NextResponse(null, {
        status: upstream.status === 404 ? 404 : 502,
        headers: { "cache-control": "public, max-age=300" },
      });
    }
    const type = upstream.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      return new NextResponse(null, { status: 415 });
    }
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BYTES)
      return new NextResponse(null, { status: 413 });
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": type,
        "cache-control":
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        "x-logo-source": target.hostname,
      },
    });
  } catch {
    return new NextResponse(null, {
      status: 504,
      headers: { "cache-control": "public, max-age=60" },
    });
  }
}
