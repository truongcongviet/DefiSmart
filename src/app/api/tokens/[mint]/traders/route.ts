import { NextResponse } from "next/server";

import { getTokenTraders } from "@/lib/traders/token-traders";

const ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Scanning an untracked token pulls up to ~1k transactions. */
export const maxDuration = 120;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mint: string }> },
) {
  const { mint } = await params;
  if (!ADDRESS_PATTERN.test(mint)) {
    return NextResponse.json(
      { message: "Invalid token mint." },
      { status: 400 },
    );
  }
  const url = new URL(request.url);
  const force = url.searchParams.get("refresh") === "1";

  try {
    const result = await getTokenTraders(mint, { force });
    return NextResponse.json(result, {
      headers: {
        "cache-control": "public, max-age=120, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to load token traders",
      },
      { status: 502 },
    );
  }
}
