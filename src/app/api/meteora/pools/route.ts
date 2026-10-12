import { NextResponse } from "next/server";

import {
  fetchDiscoveryPools,
  isCategory,
  isTimeframe,
} from "@/lib/api/meteora-pools";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const timeframe = url.searchParams.get("timeframe");
  const category = url.searchParams.get("category");
  const afterKey = url.searchParams.get("after_key") ?? undefined;
  const query = url.searchParams.get("q")?.trim() || undefined;
  const quality = url.searchParams.get("quality") !== "0";
  const pageSize = Number(url.searchParams.get("page_size") ?? 50);

  try {
    const page = await fetchDiscoveryPools({
      timeframe: isTimeframe(timeframe) ? timeframe : "2h",
      category: isCategory(category) ? category : "top",
      afterKey,
      query,
      quality,
      pageSize: Number.isFinite(pageSize) ? pageSize : 50,
    });
    return NextResponse.json(page, {
      headers: {
        "cache-control": "public, max-age=30, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to load Meteora pools",
      },
      { status: 502 },
    );
  }
}
