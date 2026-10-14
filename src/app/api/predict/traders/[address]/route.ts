import { NextResponse } from "next/server";

import { getPredictTraderProfile } from "@/lib/predict/trader-profile";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!ADDRESS_PATTERN.test(address)) {
    return NextResponse.json(
      { message: "Invalid Polygon address." },
      { status: 400 },
    );
  }
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  try {
    const profile = await getPredictTraderProfile(address, { force });
    return NextResponse.json(profile, {
      headers: {
        "cache-control": "public, max-age=120, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Failed to load trader",
      },
      { status: 502 },
    );
  }
}
