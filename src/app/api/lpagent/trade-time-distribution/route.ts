import axios from "axios";
import { NextResponse } from "next/server";

import { isValidWalletAddress } from "@/lib/analysis/classifier";
import { fetchLpHistoricalPositions } from "@/lib/api/lpagent";
import { getNested, isRecord, toNumber } from "@/lib/utils";

interface DistributionBucket {
  key: "morning" | "noon" | "afternoon" | "night";
  label: string;
  range: string;
  count: number;
}

interface HistoricalPage {
  items: Array<Record<string, unknown>>;
  currentPage: number;
  totalPages: number;
  totalCount: number;
}

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SCAN = 450;
const PAGE_DELAY_MS = 120;
const DEFAULT_MIN_ABS_PNL_NATIVE = 0;

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

  return Math.max(min, Math.min(max, parsed));
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRetryAfterSeconds(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function computeDelayMs(error: unknown, attempt: number): number {
  if (!axios.isAxiosError(error) || error.response?.status !== 429) {
    return 0;
  }

  const retryAfter = parseRetryAfterSeconds(error.response.headers["retry-after"]);
  if (retryAfter !== null) {
    return Math.min(8_000, Math.max(250, retryAfter * 1_000));
  }

  return Math.min(5_000, 400 * 2 ** attempt + Math.floor(Math.random() * 200));
}

async function withRetry<T>(task: () => Promise<T>, maxRetries = 4): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const delay = computeDelayMs(error, attempt);
      if (delay <= 0 || attempt === maxRetries) {
        throw error;
      }
      await sleep(delay);
    }
  }

  throw lastError;
}

function parseHistoricalPage(payload: unknown): HistoricalPage {
  const rawData = isRecord(payload) ? payload.data : undefined;
  const rawItems = isRecord(rawData) ? rawData.data : undefined;
  const items = Array.isArray(rawItems)
    ? (rawItems as Array<Record<string, unknown>>)
    : [];

  return {
    items,
    currentPage: toNumber(getNested(rawData, ["pagination", "currentPage"])) || 1,
    totalPages: toNumber(getNested(rawData, ["pagination", "totalPages"])) || 1,
    totalCount: toNumber(getNested(rawData, ["pagination", "totalCount"])) || items.length,
  };
}

function baseBuckets(): DistributionBucket[] {
  return [
    {
      key: "morning",
      label: "Sáng",
      range: "00:00 - 05:59",
      count: 0,
    },
    {
      key: "noon",
      label: "Trưa",
      range: "06:00 - 11:59",
      count: 0,
    },
    {
      key: "afternoon",
      label: "Chiều",
      range: "12:00 - 17:59",
      count: 0,
    },
    {
      key: "night",
      label: "Tối",
      range: "18:00 - 23:59",
      count: 0,
    },
  ];
}

function addPositionToBuckets(
  item: Record<string, unknown>,
  buckets: DistributionBucket[],
  minAbsPnlNative: number,
) {
  const pnlNative = toNumber(
    getNested(item, ["pnlNative"]) ?? getNested(item, ["pnl", "valueNative"]),
  );
  if (Math.abs(pnlNative) < minAbsPnlNative) {
    return false;
  }

  const createdAt = typeof item.createdAt === "string" ? item.createdAt : "";
  if (!createdAt) {
    return false;
  }

  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) {
    return false;
  }

  const hour = new Date(timestamp).getHours();

  if (hour < 6) {
    buckets[0].count += 1;
  } else if (hour < 12) {
    buckets[1].count += 1;
  } else if (hour < 18) {
    buckets[2].count += 1;
  } else {
    buckets[3].count += 1;
  }

  return true;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner")?.trim() ?? "";

  if (!owner) {
    return NextResponse.json(
      { message: "Missing required query param: owner" },
      { status: 400 },
    );
  }

  if (!isValidWalletAddress(owner)) {
    return NextResponse.json(
      { message: "Invalid Solana wallet address." },
      { status: 400 },
    );
  }

  const buckets = baseBuckets();
  const warnings: string[] = [];
  const minAbsPnlNative = normalizeNumberParam(
    url.searchParams.get("minAbsPnlNative"),
    DEFAULT_MIN_ABS_PNL_NATIVE,
    0,
    100_000,
  );

  let totalPages = 1;
  let totalExpected = 0;
  let pagesFetched = 0;
  let processedPositions = 0;
  let qualifiedPositions = 0;
  let validTimestampPositions = 0;
  let stoppedReason: string | null = null;

  try {
    const firstPayload = await withRetry(() =>
      fetchLpHistoricalPositions(owner, 1, DEFAULT_PAGE_SIZE),
    );

    const firstPage = parseHistoricalPage(firstPayload);
    totalPages = Math.max(1, firstPage.totalPages);
    totalExpected = Math.max(firstPage.totalCount, firstPage.items.length);

    for (const item of firstPage.items) {
      processedPositions += 1;
      const pnlNative = toNumber(
        getNested(item, ["pnlNative"]) ?? getNested(item, ["pnl", "valueNative"]),
      );
      if (Math.abs(pnlNative) >= minAbsPnlNative) {
        qualifiedPositions += 1;
      }
      if (addPositionToBuckets(item, buckets, minAbsPnlNative)) {
        validTimestampPositions += 1;
      }
    }
    pagesFetched = 1;

    const maxPagesToScan = Math.min(totalPages, MAX_PAGE_SCAN);

    for (let page = 2; page <= maxPagesToScan; page += 1) {
      await sleep(PAGE_DELAY_MS);

      try {
        const payload = await withRetry(() =>
          fetchLpHistoricalPositions(owner, page, DEFAULT_PAGE_SIZE),
        );
        const parsed = parseHistoricalPage(payload);

        pagesFetched += 1;
        for (const item of parsed.items) {
          processedPositions += 1;
          const pnlNative = toNumber(
            getNested(item, ["pnlNative"]) ??
              getNested(item, ["pnl", "valueNative"]),
          );
          if (Math.abs(pnlNative) >= minAbsPnlNative) {
            qualifiedPositions += 1;
          }
          if (addPositionToBuckets(item, buckets, minAbsPnlNative)) {
            validTimestampPositions += 1;
          }
        }
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          stoppedReason = "rate_limited";
          warnings.push(
            `Stopped at page ${page} vì bị rate-limit 429. Dữ liệu đang là partial.`,
          );
          break;
        }

        stoppedReason = "upstream_error";
        warnings.push(
          `Stopped at page ${page} do lỗi upstream: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
        break;
      }
    }

    if (totalPages > MAX_PAGE_SCAN && pagesFetched >= MAX_PAGE_SCAN) {
      stoppedReason = "max_scan_reached";
      warnings.push(
        `Đã chạm ngưỡng quét ${MAX_PAGE_SCAN} trang để tránh timeout, dữ liệu có thể partial.`,
      );
    }

    const totalTrades = buckets.reduce((sum, item) => sum + item.count, 0);
    const isPartial = pagesFetched < totalPages;
    const coverageRatio = totalExpected > 0 ? processedPositions / totalExpected : 0;

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      owner,
      period: "createdAt",
      minAbsPnlNative,
      buckets,
      totalTrades,
      processedPositions,
      qualifiedPositions,
      validTimestampPositions,
      totalExpected,
      isPartial,
      coverageRatio,
      meta: {
        pagesFetched,
        totalPages,
        stoppedReason,
      },
      warnings,
    });
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
