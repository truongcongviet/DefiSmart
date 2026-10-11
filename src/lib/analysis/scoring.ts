import axios from "axios";

import {
  fetchLpHistoricalPositions,
  fetchLpOpeningPositions,
  fetchLpOverview,
} from "@/lib/api/lp-data";
import { asArray, clamp, getNested, isRecord, safeRatio, toNumber } from "@/lib/utils";

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 350;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 3;

const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "USDS",
  "DAI",
  "USDE",
  "FDUSD",
  "TUSD",
  "USDP",
  "PYUSD",
  "USDH",
  "USDC.E",
]);

const MAJOR_SYMBOLS = new Set(["SOL", "BTC", "ETH", "WBTC", "WETH", "JUP", "RAY"]);

type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
type ScoreTier = "Smart LP" | "Watchlist" | "Risky";
type TokenCategory =
  | "stable_stable"
  | "stable_major"
  | "stable_alt"
  | "major_major"
  | "alt_speculative";

interface PositionRecord {
  owner: string;
  pool: string;
  position: string;
  status: string;
  token0Symbol: string;
  token1Symbol: string;
  pnlNative: number;
  feeNative: number;
  valueNative: number;
  createdAt: string | null;
  updatedAt: string | null;
  closeAt: string | null;
}

interface HistoricalPageResult {
  items: PositionRecord[];
  currentPage: number;
  totalPages: number;
  totalCount: number;
}

interface ApiWarning {
  source: string;
  status?: number;
  message: string;
}

interface SourceStatus {
  overview: boolean;
  historical: boolean;
  opening: boolean;
}

interface OverviewAggregate {
  totalLp: number;
  openingLp: number;
  closedLp: number;
  totalPool: number;
  totalPnlNative: number;
  totalFeeNative: number;
  winRateNative: number;
}

interface ScoreBreakdown {
  profit: number;
  stability: number;
  risk: number;
  poolSelection: number;
}

interface ScoreConfidence {
  value: number;
  level: ConfidenceLevel;
  reasons: string[];
}

interface ScoreSummary {
  totalPositions: number;
  openingPositions: number;
  closedPositions: number;
  uniquePools: number;
  totalPnlNative: number;
  totalFeeNative: number;
  winRate: number;
  avgClosedPnlNative: number;
}

interface TokenMix {
  totalPositions: number;
  stableExposureRatio: number;
  speculativeExposureRatio: number;
  counts: Record<TokenCategory, number>;
}

interface ScoreMeta {
  pageSize: number;
  maxPages: number;
  sources: SourceStatus;
  historical: {
    pagesFetched: number;
    totalPages: number;
    totalCount: number;
    records: number;
    isPartial: boolean;
    stoppedReason?: string;
  };
}

export interface WalletScoreResult {
  generatedAt: string;
  owner: string;
  tier: ScoreTier;
  totalScore: number;
  breakdown: ScoreBreakdown;
  confidence: ScoreConfidence;
  summary: ScoreSummary;
  tokenMix: TokenMix;
  reasons: string[];
  warnings: ApiWarning[];
  meta: ScoreMeta;
}

interface CalculateWalletScoreOptions {
  pageSize?: number;
  maxPages?: number;
}

interface HistoricalFetchResult {
  items: PositionRecord[];
  pagesFetched: number;
  totalPages: number;
  totalCount: number;
  stoppedReason?: "rate_limited";
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

function computeRetryDelayMs(error: unknown, attempt: number): number {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  const retryAfter =
    axios.isAxiosError(error) && error.response
      ? parseRetryAfterSeconds(error.response.headers["retry-after"])
      : null;

  if (status !== 429) {
    return 0;
  }

  if (retryAfter !== null) {
    return Math.min(5_000, Math.max(200, retryAfter * 1_000));
  }

  const exponential = RETRY_BASE_DELAY_MS * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 200);
  return Math.min(3_000, exponential + jitter);
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRateLimitRetry<T>(
  task: () => Promise<T>,
  maxRetries = MAX_RETRIES,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const delay = computeRetryDelayMs(error, attempt);
      if (delay <= 0 || attempt === maxRetries) {
        throw error;
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

function extractAxiosErrorInfo(error: unknown) {
  if (axios.isAxiosError(error)) {
    return {
      status: error.response?.status,
      message:
        String(error.response?.data?.message ?? "").trim() ||
        error.message ||
        "Upstream API request failed",
    };
  }

  if (error instanceof Error) {
    return {
      status: undefined,
      message: error.message,
    };
  }

  return {
    status: undefined,
    message: "Unknown error",
  };
}

function isAxiosRateLimited(error: unknown) {
  return axios.isAxiosError(error) && error.response?.status === 429;
}

function normalizeRatio(raw: number) {
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }

  if (raw > 1) {
    return clamp(raw / 100, 0, 1);
  }

  return clamp(raw, 0, 1);
}

function pickMetric(value: unknown, preferredKey = "ALL") {
  if (typeof value === "number" || typeof value === "string") {
    return toNumber(value);
  }

  if (!isRecord(value)) {
    return 0;
  }

  if (preferredKey in value) {
    return toNumber(value[preferredKey]);
  }

  for (const key of ["1M", "30D", "7D", "3M", "YTD", "1Y"]) {
    if (key in value) {
      const parsed = toNumber(value[key]);
      if (parsed !== 0) {
        return parsed;
      }
    }
  }

  return 0;
}

function normalizeSymbol(raw: unknown) {
  if (typeof raw !== "string") {
    return "";
  }

  return raw.trim().toUpperCase();
}

function splitPairSymbols(pairName: string): { token0Symbol: string; token1Symbol: string } {
  const normalized = pairName.trim();
  if (!normalized) {
    return {
      token0Symbol: "",
      token1Symbol: "",
    };
  }

  for (const separator of ["/", "-", "_"]) {
    if (normalized.includes(separator)) {
      const [left = "", right = ""] = normalized
        .split(separator)
        .map((part) => part.trim());

      return {
        token0Symbol: left,
        token1Symbol: right,
      };
    }
  }

  return {
    token0Symbol: normalized,
    token1Symbol: "",
  };
}

function toIsoOrNull(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }

  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) {
    return null;
  }

  return new Date(ts).toISOString();
}

function parsePairInfo(item: Record<string, unknown>) {
  const pairNameRaw = String(item.pairName ?? "").trim();
  const fallback = splitPairSymbols(pairNameRaw);

  const token0Symbol = normalizeSymbol(
    item.tokenName0 ??
      getNested(item, ["token0Info", "token_symbol"]) ??
      fallback.token0Symbol,
  );

  const token1Symbol = normalizeSymbol(
    item.tokenName1 ??
      getNested(item, ["token1Info", "token_symbol"]) ??
      fallback.token1Symbol,
  );

  return {
    token0Symbol,
    token1Symbol,
  };
}

function normalizePositionRecord(
  item: unknown,
  fallbackOwner: string,
): PositionRecord | null {
  if (!isRecord(item)) {
    return null;
  }

  const owner = String(item.owner ?? fallbackOwner).trim() || fallbackOwner;
  const position = String(item.position ?? item.tokenId ?? "").trim();
  const pool = String(item.pool ?? item.poolAddress ?? item.pool_address ?? "").trim();
  const status = String(item.status ?? "").trim() || "unknown";
  const pairInfo = parsePairInfo(item);

  const createdAt = toIsoOrNull(item.createdAt);
  const updatedAt = toIsoOrNull(item.updatedAt);
  const closeAt = toIsoOrNull(item.closeAt ?? item.close_At);

  if (!position && !pool) {
    return null;
  }

  return {
    owner,
    pool,
    position,
    status,
    token0Symbol: pairInfo.token0Symbol,
    token1Symbol: pairInfo.token1Symbol,
    pnlNative: toNumber(item.pnlNative ?? getNested(item, ["pnl", "valueNative"])),
    feeNative: toNumber(item.feeNative ?? item.collectedFeeNative),
    valueNative: toNumber(item.valueNative ?? item.inputNative),
    createdAt,
    updatedAt,
    closeAt,
  };
}

function extractHistoricalPage(payload: unknown, fallbackOwner: string): HistoricalPageResult {
  const rawData = isRecord(payload) ? payload.data : undefined;
  const nestedData = isRecord(rawData) ? rawData.data : undefined;

  const items = asArray<Record<string, unknown>>(nestedData)
    .map((item) => normalizePositionRecord(item, fallbackOwner))
    .filter((item): item is PositionRecord => item !== null);

  const rawPagination = isRecord(rawData) ? rawData.pagination : undefined;

  return {
    items,
    currentPage: toNumber(getNested(rawPagination, ["currentPage"])) || 1,
    totalPages: toNumber(getNested(rawPagination, ["totalPages"])) || 1,
    totalCount: toNumber(getNested(rawPagination, ["totalCount"])) || items.length,
  };
}

function extractOpeningItems(payload: unknown, owner: string): PositionRecord[] {
  if (!isRecord(payload)) {
    return [];
  }

  return asArray<Record<string, unknown>>(payload.data)
    .map((item) => normalizePositionRecord(item, owner))
    .filter((item): item is PositionRecord => item !== null);
}

function dedupePositions(items: PositionRecord[]): PositionRecord[] {
  const map = new Map<string, PositionRecord>();

  for (const item of items) {
    const key = [item.position, item.createdAt, item.closeAt, item.status].join("|");
    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
}

async function fetchAllHistoricalPositions(
  owner: string,
  pageSize: number,
  maxPages: number,
): Promise<HistoricalFetchResult> {
  const all: PositionRecord[] = [];
  let currentPage = 1;
  let totalPages = 1;
  let totalCount = 0;

  while (currentPage <= totalPages && currentPage <= maxPages) {
    let page: HistoricalPageResult;

    try {
      const payload = await withRateLimitRetry(() =>
        fetchLpHistoricalPositions(owner, currentPage, pageSize),
      );
      page = extractHistoricalPage(payload, owner);
    } catch (error) {
      if (isAxiosRateLimited(error)) {
        return {
          items: all,
          pagesFetched: Math.max(0, currentPage - 1),
          totalPages,
          totalCount,
          stoppedReason: "rate_limited",
        };
      }

      throw error;
    }

    all.push(...page.items);
    totalPages = Math.max(1, page.totalPages);
    totalCount = Math.max(page.totalCount, totalCount);

    if (page.items.length === 0) {
      break;
    }

    currentPage += 1;
  }

  return {
    items: all,
    pagesFetched: Math.max(0, currentPage - 1),
    totalPages,
    totalCount,
  };
}

function aggregateOverview(overview: Record<string, unknown>[]): OverviewAggregate {
  let totalLp = 0;
  let openingLp = 0;
  let closedLp = 0;
  let totalPool = 0;
  let totalPnlNative = 0;
  let totalFeeNative = 0;
  let weightedWinNumerator = 0;
  let weightedWinDenominator = 0;

  for (const item of overview) {
    const itemTotalLp = toNumber(item.total_lp);
    const itemOpeningLp = toNumber(item.opening_lp);
    const itemClosedLp = pickMetric(item.closed_lp);
    const itemTotalPool = toNumber(item.total_pool);
    const itemTotalPnlNative = pickMetric(item.total_pnl_native ?? item.total_pnl);
    const itemTotalFeeNative = pickMetric(item.total_fee_native ?? item.total_fee);
    const itemWinRate = normalizeRatio(
      pickMetric(item.win_rate_native ?? item.win_rate),
    );

    totalLp += itemTotalLp;
    openingLp += itemOpeningLp;
    closedLp += itemClosedLp;
    totalPool += itemTotalPool;
    totalPnlNative += itemTotalPnlNative;
    totalFeeNative += itemTotalFeeNative;

    const weight = itemClosedLp > 0 ? itemClosedLp : itemTotalLp;
    if (weight > 0) {
      weightedWinNumerator += itemWinRate * weight;
      weightedWinDenominator += weight;
    }
  }

  return {
    totalLp,
    openingLp,
    closedLp,
    totalPool,
    totalPnlNative,
    totalFeeNative,
    winRateNative:
      weightedWinDenominator > 0 ? weightedWinNumerator / weightedWinDenominator : 0,
  };
}

function isClosedPosition(item: PositionRecord) {
  return item.status.toLowerCase().includes("close") || Boolean(item.closeAt);
}

function computeHoldHours(position: PositionRecord, nowMs: number): number | null {
  if (!position.createdAt) {
    return null;
  }

  const startMs = Date.parse(position.createdAt);
  if (Number.isNaN(startMs)) {
    return null;
  }

  const endRaw = position.closeAt ?? position.updatedAt;
  const endMs = endRaw ? Date.parse(endRaw) : nowMs;
  if (Number.isNaN(endMs) || endMs <= startMs) {
    return null;
  }

  return (endMs - startMs) / 3_600_000;
}

function computeMedian(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function classifyTokenCategory(position: PositionRecord): TokenCategory {
  const token0 = normalizeSymbol(position.token0Symbol);
  const token1 = normalizeSymbol(position.token1Symbol);

  const token0Stable = token0 !== "" && STABLE_SYMBOLS.has(token0);
  const token1Stable = token1 !== "" && STABLE_SYMBOLS.has(token1);
  const token0Major = token0 !== "" && MAJOR_SYMBOLS.has(token0);
  const token1Major = token1 !== "" && MAJOR_SYMBOLS.has(token1);

  if (token0Stable && token1Stable) {
    return "stable_stable";
  }

  if ((token0Stable && token1Major) || (token1Stable && token0Major)) {
    return "stable_major";
  }

  if (token0Stable || token1Stable) {
    return "stable_alt";
  }

  if (token0Major && token1Major) {
    return "major_major";
  }

  return "alt_speculative";
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100;
}

function buildScoreReasons(
  totalScore: number,
  summary: ScoreSummary,
  tokenMix: TokenMix,
  confidence: ScoreConfidence,
) {
  const reasons: string[] = [];

  if (totalScore >= 75) {
    reasons.push("Điểm tổng cao: ví thể hiện hiệu suất và tính kỷ luật tốt.");
  } else if (totalScore >= 50) {
    reasons.push("Điểm trung bình: ví có tín hiệu tốt nhưng còn biến động.");
  } else {
    reasons.push("Điểm thấp: hiệu suất hoặc quản trị rủi ro chưa ổn định.");
  }

  if (summary.totalPnlNative > 0) {
    reasons.push("Tổng PnL dương trên tập dữ liệu hiện có.");
  } else {
    reasons.push("Tổng PnL chưa dương, cần theo dõi thêm trước khi copy.");
  }

  if (summary.winRate >= 0.6) {
    reasons.push("Win rate cao hỗ trợ độ ổn định chiến lược.");
  } else if (summary.winRate < 0.5) {
    reasons.push("Win rate dưới 50% làm tăng rủi ro khi follow.");
  }

  if (tokenMix.speculativeExposureRatio >= 0.6) {
    reasons.push("Tỷ trọng token speculative cao, mức rủi ro thị trường lớn.");
  } else if (tokenMix.stableExposureRatio >= 0.55) {
    reasons.push("Tỷ trọng stable/major cao giúp giảm biến động danh mục.");
  }

  if (confidence.level !== "HIGH") {
    reasons.push("Độ tin cậy chưa cao do coverage dữ liệu còn hạn chế.");
  }

  return reasons;
}

export async function calculateWalletScore(
  owner: string,
  options: CalculateWalletScoreOptions = {},
): Promise<WalletScoreResult> {
  const pageSize = clamp(
    Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE),
    20,
    100,
  );
  const maxPages = clamp(
    Math.floor(options.maxPages ?? DEFAULT_MAX_PAGES),
    1,
    5,
  );

  const warnings: ApiWarning[] = [];
  const sourceStatus: SourceStatus = {
    overview: false,
    historical: false,
    opening: false,
  };

  let overviewEntries: Record<string, unknown>[] = [];

  try {
    const overviewPayload = await withRateLimitRetry(() => fetchLpOverview(owner), 4);
    overviewEntries = isRecord(overviewPayload)
      ? asArray<Record<string, unknown>>(overviewPayload.data)
      : [];
    sourceStatus.overview = true;
  } catch (error) {
    const info = extractAxiosErrorInfo(error);
    warnings.push({
      source: "overview",
      status: info.status,
      message: info.message,
    });
  }

  const historicalResult = await fetchAllHistoricalPositions(owner, pageSize, maxPages);
  sourceStatus.historical = true;

  if (historicalResult.stoppedReason === "rate_limited") {
    warnings.push({
      source: "historical",
      status: 429,
      message: "Historical positions bị rate-limit, dữ liệu score đang partial.",
    });
  }

  let openingPositions: PositionRecord[] = [];
  try {
    const openingPayload = await withRateLimitRetry(() => fetchLpOpeningPositions(owner));
    openingPositions = extractOpeningItems(openingPayload, owner);
    sourceStatus.opening = true;
  } catch (error) {
    const info = extractAxiosErrorInfo(error);
    warnings.push({
      source: "opening",
      status: info.status,
      message: info.message,
    });
  }

  const allPositions = dedupePositions([
    ...historicalResult.items,
    ...openingPositions,
  ]);

  const overview = aggregateOverview(overviewEntries);
  const hasOverview = overviewEntries.length > 0;

  const closedSample = allPositions.filter(isClosedPosition);
  const openSample = allPositions.filter((item) => !isClosedPosition(item));

  const totalPositions = hasOverview ? overview.totalLp : allPositions.length;
  const openingPositionsCount = hasOverview ? overview.openingLp : openSample.length;
  const closedPositions = hasOverview ? overview.closedLp : closedSample.length;
  const uniquePools = hasOverview
    ? overview.totalPool
    : new Set(allPositions.map((item) => item.pool).filter(Boolean)).size;
  const totalPnlNative = hasOverview
    ? overview.totalPnlNative
    : allPositions.reduce((sum, item) => sum + item.pnlNative, 0);
  const totalFeeNative = hasOverview
    ? overview.totalFeeNative
    : allPositions.reduce((sum, item) => sum + item.feeNative, 0);

  const winRate =
    hasOverview && overview.winRateNative > 0
      ? overview.winRateNative
      : closedSample.length > 0
        ? closedSample.filter((item) => item.pnlNative > 0).length / closedSample.length
        : 0;

  const avgClosedPnlNative =
    closedPositions > 0 ? totalPnlNative / closedPositions : 0;

  const summary: ScoreSummary = {
    totalPositions,
    openingPositions: openingPositionsCount,
    closedPositions,
    uniquePools,
    totalPnlNative,
    totalFeeNative,
    winRate: normalizeRatio(winRate),
    avgClosedPnlNative,
  };

  const tokenMixCounts: Record<TokenCategory, number> = {
    stable_stable: 0,
    stable_major: 0,
    stable_alt: 0,
    major_major: 0,
    alt_speculative: 0,
  };

  for (const position of allPositions) {
    tokenMixCounts[classifyTokenCategory(position)] += 1;
  }

  const totalTokenPositions = allPositions.length;
  const stableExposureRatio =
    totalTokenPositions > 0
      ? (tokenMixCounts.stable_stable +
          tokenMixCounts.stable_major +
          tokenMixCounts.stable_alt) /
        totalTokenPositions
      : 0;
  const speculativeExposureRatio =
    totalTokenPositions > 0
      ? tokenMixCounts.alt_speculative / totalTokenPositions
      : 0;

  const tokenMix: TokenMix = {
    totalPositions: totalTokenPositions,
    stableExposureRatio,
    speculativeExposureRatio,
    counts: tokenMixCounts,
  };

  const nowMs = Date.now();
  const holdHours = closedSample
    .map((item) => computeHoldHours(item, nowMs))
    .filter((item): item is number => item !== null);

  const avgHoldHours =
    holdHours.length > 0
      ? holdHours.reduce((sum, value) => sum + value, 0) / holdHours.length
      : 0;
  const medianHoldHours = computeMedian(holdHours);

  const closedPnlValues = closedSample.map((item) => item.pnlNative);
  const meanClosedPnl =
    closedPnlValues.length > 0
      ? closedPnlValues.reduce((sum, value) => sum + value, 0) /
        closedPnlValues.length
      : 0;

  const varianceClosedPnl =
    closedPnlValues.length > 1
      ? closedPnlValues.reduce((sum, value) => {
          return sum + (value - meanClosedPnl) ** 2;
        }, 0) / closedPnlValues.length
      : 0;
  const stdClosedPnl = Math.sqrt(Math.max(0, varianceClosedPnl));
  const pnlConsistency =
    closedPnlValues.length === 0
      ? 0.5
      : clamp(1 - stdClosedPnl / (Math.abs(meanClosedPnl) * 2 + 1e-9), 0, 1);

  const holdScore = (() => {
    if (avgHoldHours <= 0) {
      return 0.5;
    }

    if (avgHoldHours < 1) {
      return clamp(0.25 + avgHoldHours * 0.45, 0, 1);
    }

    if (avgHoldHours <= 72) {
      return 1;
    }

    if (avgHoldHours <= 240) {
      return clamp(1 - ((avgHoldHours - 72) / 168) * 0.55, 0.35, 1);
    }

    return 0.35;
  })();

  const winRateNorm = clamp((summary.winRate - 0.35) / 0.45, 0, 1);
  const totalPnlNorm = clamp(0.5 + Math.tanh(summary.totalPnlNative / 25) * 0.5, 0, 1);
  const avgClosedPnlNorm = clamp(
    0.5 + Math.tanh(summary.avgClosedPnlNative / 1.5) * 0.5,
    0,
    1,
  );

  const largeLossRatio =
    closedSample.length > 0
      ? closedSample.filter((item) => item.pnlNative < -1).length / closedSample.length
      : 0;
  const poolConcentrationPenalty = 1 - clamp(summary.uniquePools / 12, 0, 1);

  const poolStats = new Map<
    string,
    {
      count: number;
      pnlSum: number;
    }
  >();

  for (const item of closedSample) {
    const key = item.pool || item.position || "unknown";
    const current = poolStats.get(key) ?? { count: 0, pnlSum: 0 };
    current.count += 1;
    current.pnlSum += item.pnlNative;
    poolStats.set(key, current);
  }

  const poolStatValues = Array.from(poolStats.values());
  const poolsForEval = poolStatValues.filter((item) => item.count >= 2);
  const poolEvalSource = poolsForEval.length > 0 ? poolsForEval : poolStatValues;
  const profitablePoolRatio =
    poolEvalSource.length > 0
      ? poolEvalSource.filter((item) => item.pnlSum / item.count > 0).length /
        poolEvalSource.length
      : 0.5;
  const poolBreadth = clamp(summary.uniquePools / 15, 0, 1);
  const netEdgeNorm = clamp(
    0.5 + Math.tanh((summary.totalPnlNative - summary.totalFeeNative) / 30) * 0.5,
    0,
    1,
  );

  const profitScoreRaw = 0.7 * totalPnlNorm + 0.3 * avgClosedPnlNorm;
  const stabilityScoreRaw =
    0.55 * winRateNorm + 0.25 * pnlConsistency + 0.2 * holdScore;
  const riskScoreRaw = clamp(
    1 -
      (0.45 * tokenMix.speculativeExposureRatio +
        0.3 * poolConcentrationPenalty +
        0.25 * largeLossRatio),
    0,
    1,
  );
  const poolSelectionRaw =
    0.45 * profitablePoolRatio + 0.35 * poolBreadth + 0.2 * netEdgeNorm;

  const breakdown: ScoreBreakdown = {
    profit: roundScore(profitScoreRaw * 30),
    stability: roundScore(stabilityScoreRaw * 25),
    risk: roundScore(riskScoreRaw * 20),
    poolSelection: roundScore(poolSelectionRaw * 25),
  };

  const totalScore = roundScore(
    breakdown.profit +
      breakdown.stability +
      breakdown.risk +
      breakdown.poolSelection,
  );

  const tier: ScoreTier =
    totalScore >= 75 ? "Smart LP" : totalScore >= 50 ? "Watchlist" : "Risky";

  const sampleCoverage = safeRatio(
    allPositions.length,
    summary.totalPositions > 0 ? summary.totalPositions : allPositions.length,
  );
  const pageCoverage = safeRatio(historicalResult.pagesFetched, historicalResult.totalPages);
  const pageCapLimited =
    historicalResult.totalPages > maxPages &&
    historicalResult.pagesFetched >= maxPages;
  let confidenceValue =
    (sourceStatus.overview ? 0.45 : 0.1) +
    (sourceStatus.historical ? 0.25 : 0) +
    (sourceStatus.opening ? 0.15 : 0) +
    0.15 * clamp(sampleCoverage / 0.35, 0, 1);

  confidenceValue += 0.1 * pageCoverage;

  if (historicalResult.stoppedReason === "rate_limited") {
    confidenceValue -= 0.2;
  }

  if (pageCapLimited) {
    confidenceValue -= 0.1;
    warnings.push({
      source: "historical",
      message:
        "Số trang historical vượt maxPages, điểm hiện dựa trên mẫu dữ liệu chứ chưa full scan.",
    });
  }

  confidenceValue = clamp(confidenceValue, 0, 1);

  const confidenceLevel: ConfidenceLevel =
    confidenceValue >= 0.75 ? "HIGH" : confidenceValue >= 0.45 ? "MEDIUM" : "LOW";

  const confidenceReasons: string[] = [];
  confidenceReasons.push(
    sourceStatus.overview
      ? "Có dữ liệu overview tổng hợp từ on-chain Meteora."
      : "Thiếu overview, một số chỉ số tổng chỉ là ước tính từ sample.",
  );
  confidenceReasons.push(
    `Coverage sample: ${(sampleCoverage * 100).toFixed(2)}% (${allPositions.length}/${Math.max(1, summary.totalPositions)}).`,
  );
  if (historicalResult.stoppedReason === "rate_limited") {
    confidenceReasons.push("Historical scan bị 429 nên confidence giảm.");
  } else if (pageCapLimited) {
    confidenceReasons.push("Historical scan chạm giới hạn maxPages.");
  }

  const confidence: ScoreConfidence = {
    value: roundScore(confidenceValue),
    level: confidenceLevel,
    reasons: confidenceReasons,
  };

  const reasons = buildScoreReasons(totalScore, summary, tokenMix, confidence);
  if (medianHoldHours > 0 && medianHoldHours < 1) {
    reasons.push("Thời gian giữ vị thế median rất ngắn, chiến lược dễ nhiễu.");
  }

  const meta: ScoreMeta = {
    pageSize,
    maxPages,
    sources: sourceStatus,
    historical: {
      pagesFetched: historicalResult.pagesFetched,
      totalPages: historicalResult.totalPages,
      totalCount: historicalResult.totalCount,
      records: historicalResult.items.length,
      isPartial:
        historicalResult.stoppedReason === "rate_limited" ||
        pageCapLimited ||
        historicalResult.pagesFetched < historicalResult.totalPages,
      ...(historicalResult.stoppedReason
        ? { stoppedReason: historicalResult.stoppedReason }
        : {}),
    },
  };

  return {
    generatedAt: new Date().toISOString(),
    owner,
    tier,
    totalScore,
    breakdown,
    confidence,
    summary,
    tokenMix,
    reasons,
    warnings,
    meta,
  };
}

