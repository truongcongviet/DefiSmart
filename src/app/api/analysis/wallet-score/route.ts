import axios from "axios";
import { NextResponse } from "next/server";

import { isValidWalletAddress } from "@/lib/analysis/classifier";
import { calculateWalletScore } from "@/lib/analysis/scoring";

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 3;

function normalizeNumberParam(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner")?.trim() ?? "";

  if (!owner) {
    return NextResponse.json(
      {
        message: "Missing required query param: owner",
      },
      { status: 400 },
    );
  }

  if (!isValidWalletAddress(owner)) {
    return NextResponse.json(
      {
        message: "Invalid Solana wallet address.",
      },
      { status: 400 },
    );
  }

  const pageSize = normalizeNumberParam(
    url.searchParams.get("pageSize"),
    DEFAULT_PAGE_SIZE,
    20,
    100,
  );
  const maxPages = normalizeNumberParam(
    url.searchParams.get("maxPages"),
    DEFAULT_MAX_PAGES,
    1,
    5,
  );

  try {
    const result = await calculateWalletScore(owner, {
      pageSize,
      maxPages,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return NextResponse.json(
        {
          message: error.response?.data?.message || error.message,
          status: error.response?.status || 500,
          upstream: error.response?.data ?? null,
        },
        { status: error.response?.status || 500 },
      );
    }

    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Unexpected server error",
      },
      { status: 500 },
    );
  }
}

