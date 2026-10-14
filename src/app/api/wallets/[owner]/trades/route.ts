import { NextResponse } from "next/server";

import { getWalletTrades } from "@/lib/traders/wallet-trades";

const ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Up to 1k transactions at ~30 tx/s. */
export const maxDuration = 120;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string }> },
) {
  const { owner } = await params;
  if (!ADDRESS_PATTERN.test(owner)) {
    return NextResponse.json(
      { message: "Invalid wallet address." },
      { status: 400 },
    );
  }
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit"));
  const force = url.searchParams.get("refresh") === "1";

  try {
    const result = await getWalletTrades(owner, {
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      force,
    });
    return NextResponse.json(result, {
      headers: { "cache-control": "private, max-age=120" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to load wallet trades",
      },
      { status: 502 },
    );
  }
}
