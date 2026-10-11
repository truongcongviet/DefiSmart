import axios from "axios";
import { NextResponse } from "next/server";

import {
  fetchLpHistoricalPositions,
  fetchLpLogs,
  fetchLpOpeningPositions,
  fetchLpOverview,
  fetchLpRevenue,
  fetchTokenBalances,
} from "@/lib/api/lp-data";
import { isValidWalletAddress } from "@/lib/analysis/classifier";
import { asArray, getNested, isRecord, toNumber } from "@/lib/utils";

interface PositionRecord {
  owner: string;
  position: string;
  pool: string;
  pairName: string;
  token0Symbol: string;
  token1Symbol: string;
  logo0: string;
  logo1: string;
  protocol: string;
  status: string;
  valueNative: number;
  pnlNative: number;
  feeNative: number;
  createdAt: string | null;
  updatedAt: string | null;
  closeAt: string | null;
}

interface TimelineEvent {
  id: string;
  type: string;
  source: "position" | "log";
  timestamp: string;
  timestampMs: number;
  owner: string;
  pairName: string;
  token0Symbol: string;
  token1Symbol: string;
  logo0?: string;
  logo1?: string;
  pool: string;
  position: string;
  status: string;
  pnlNative: number;
  valueNative: number;
  feeNative: number;
  txHash?: string;
  action?: string;
  amount0?: number;
  amount1?: number;
  nativePrice?: number;
}

interface HistoricalPageResult {
  items: PositionRecord[];
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalCount: number;
}

interface LogsFetchResult {
  events: TimelineEvent[];
  requestedPositions: number;
  fetchedPositions: number;
  failedPositions: number;
}

interface ApiWarning {
  source: string;
  status?: number;
  message: string;
}

interface HistoricalFetchResult {
  items: PositionRecord[];
  pagesFetched: number;
  totalPages: number;
  stoppedReason?: "rate_limited";
}

type TokenCategory =
  | "stable_stable"
  | "stable_major"
  | "stable_alt"
  | "major_major"
  | "alt_speculative";

interface StrategyInsight {
  type: "SCALP" | "SWING" | "UNKNOWN";
  thresholdHours: number;
  averageHoldHours: number;
  medianHoldHours: number;
  scalpPositions: number;
  swingPositions: number;
  sampledPositions: number;
}

interface TokenMixInsight {
  totalPositions: number;
  counts: Record<TokenCategory, number>;
  dominantCategory: TokenCategory | "unknown";
  stableExposureRatio: number;
  speculativeExposureRatio: number;
  topPairs: Array<{ pair: string; count: number }>;
}

interface WalletSignalInsight {
  isSmart: boolean;
  status: "GREEN_TICK" | "RED_X";
  symbol: "✓" | "✕";
  label: string;
  reasons: string[];
}

interface WalletInsights {
  strategy: StrategyInsight;
  tokenMix: TokenMixInsight;
  signal: WalletSignalInsight;
  warnings: string[];
}

interface WalletSummary {
  owner: string;
  totalPositions: number;
  openingPositions: number;
  closedPositions: number;
  uniquePools: number;
  uniqueProtocols: number;
  totalPnlNative: number;
  totalFeeNative: number;
  winRate: number;
  winCount: number;
  lossCount: number;
  positivePnlRatio: number;
  avgClosedPnlNative: number;
  firstActivity: string | null;
  lastActivity: string | null;
}

interface OverviewAggregate {
  totalLp: number;
  openingLp: number;
  closedLp: number;
  totalPool: number;
  totalPnlNative: number;
  totalFeeNative: number;
  winRateNative: number;
  weightedWinBase: number;
  uniqueProtocols: number;
  firstActivity: string | null;
  lastActivity: string | null;
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGE_SIZE = 100;
const MAX_MAX_PAGES = 5;
const DEFAULT_LOG_POSITIONS = 2;
const MAX_LOG_POSITIONS = 5;
const DEFAULT_INCLUDE_LOGS = false;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 350;
const HOLD_THRESHOLD_HOURS = 5;
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

function normalizeBooleanParam(raw: string | null, fallback = false) {
  if (raw === null) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
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

function parseTimestamp(raw: unknown): number {
  if (typeof raw !== "string" || raw.trim() === "") {
    return 0;
  }

  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? 0 : ts;
}

function toIsoOrNull(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }

  const timestamp = parseTimestamp(raw);
  if (timestamp === 0) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function toCleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function splitPairSymbols(pairName: string) {
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

function parsePairInfo(item: Record<string, unknown>) {
  const rawPairName = toCleanString(item.pairName);

  const fallbackFromPair = splitPairSymbols(rawPairName);
  const token0Symbol =
    toCleanString(item.tokenName0) ||
    toCleanString(getNested(item, ["token0Info", "token_symbol"])) ||
    fallbackFromPair.token0Symbol;
  const token1Symbol =
    toCleanString(item.tokenName1) ||
    toCleanString(getNested(item, ["token1Info", "token_symbol"])) ||
    fallbackFromPair.token1Symbol;

  const pairName =
    rawPairName ||
    (token0Symbol && token1Symbol
      ? `${token0Symbol}/${token1Symbol}`
      : token0Symbol || token1Symbol || "-");

  const logo0 =
    toCleanString(item.logo0) ||
    toCleanString(getNested(item, ["token0Info", "logo"]));
  const logo1 =
    toCleanString(item.logo1) ||
    toCleanString(getNested(item, ["token1Info", "logo"]));

  return {
    pairName,
    token0Symbol,
    token1Symbol,
    logo0,
    logo1,
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
  const protocol = String(item.protocol ?? "").trim() || "unknown";
  const status = String(item.status ?? "").trim() || "Unknown";

  const createdAt = toIsoOrNull(item.createdAt);
  const updatedAt = toIsoOrNull(item.updatedAt);
  const closeAt = toIsoOrNull(item.closeAt ?? item.close_At);
  const pairInfo = parsePairInfo(item);

  if (!position && !pool) {
    return null;
  }

  return {
    owner,
    position,
    pool,
    pairName: pairInfo.pairName,
    token0Symbol: pairInfo.token0Symbol,
    token1Symbol: pairInfo.token1Symbol,
    logo0: pairInfo.logo0,
    logo1: pairInfo.logo1,
    protocol,
    status,
    valueNative: toNumber(item.valueNative ?? item.inputNative),
    pnlNative: toNumber(item.pnlNative ?? getNested(item, ["pnl", "valueNative"])),
    feeNative: toNumber(item.feeNative ?? item.collectedFeeNative),
    createdAt,
    updatedAt,
    closeAt,
  };
}

function extractHistoricalPage(
  payload: unknown,
  fallbackOwner: string,
): HistoricalPageResult {
  const rawData = isRecord(payload) ? payload.data : undefined;

  const nestedData = isRecord(rawData) ? rawData.data : undefined;
  const directItems = asArray<Record<string, unknown>>(nestedData);

  const items = directItems
    .map((item) => normalizePositionRecord(item, fallbackOwner))
    .filter((item): item is PositionRecord => item !== null);

  const rawPagination = isRecord(rawData) ? rawData.pagination : undefined;

  return {
    items,
    currentPage: toNumber(getNested(rawPagination, ["currentPage"])) || 1,
    totalPages: toNumber(getNested(rawPagination, ["totalPages"])) || 1,
    pageSize: toNumber(getNested(rawPagination, ["pageSize"])) || items.length,
    totalCount: toNumber(getNested(rawPagination, ["totalCount"])) || items.length,
  };
}

async function fetchAllHistoricalPositions(
  owner: string,
  pageSize: number,
  maxPages: number,
): Promise<HistoricalFetchResult> {
  const all: PositionRecord[] = [];
  let currentPage = 1;
  let totalPages = 1;

  while (currentPage <= totalPages && currentPage <= maxPages) {
    let parsed: HistoricalPageResult;

    try {
      const payload = await withRateLimitRetry(() =>
        fetchLpHistoricalPositions(owner, currentPage, pageSize),
      );
      parsed = extractHistoricalPage(payload, owner);
    } catch (error) {
      if (isAxiosRateLimited(error)) {
        return {
          items: all,
          pagesFetched: Math.max(0, currentPage - 1),
          totalPages,
          stoppedReason: "rate_limited",
        };
      }

      throw error;
    }

    all.push(...parsed.items);
    totalPages = Math.max(1, parsed.totalPages);

    if (parsed.items.length === 0) {
      break;
    }

    currentPage += 1;
  }

  const pagesFetched = Math.max(0, currentPage - 1);

  return {
    items: all,
    pagesFetched,
    totalPages,
  };
}

function extractOpeningItems(payload: unknown, fallbackOwner: string) {
  if (!isRecord(payload)) {
    return [] as PositionRecord[];
  }

  const data = asArray<Record<string, unknown>>(payload.data);

  return data
    .map((item) => normalizePositionRecord(item, fallbackOwner))
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

function createPositionTimeline(items: PositionRecord[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const position of items) {
    const base = {
      owner: position.owner,
      pairName: position.pairName,
      token0Symbol: position.token0Symbol,
      token1Symbol: position.token1Symbol,
      logo0: position.logo0 || undefined,
      logo1: position.logo1 || undefined,
      pool: position.pool,
      position: position.position,
      status: position.status,
      pnlNative: position.pnlNative,
      valueNative: position.valueNative,
      feeNative: position.feeNative,
    };

    if (position.createdAt) {
      const ts = Date.parse(position.createdAt);
      events.push({
        id: `${position.position}-open-${position.createdAt}`,
        type: "open",
        source: "position",
        timestamp: position.createdAt,
        timestampMs: ts,
        ...base,
      });
    }

    if (
      position.updatedAt &&
      position.updatedAt !== position.createdAt &&
      position.updatedAt !== position.closeAt
    ) {
      const ts = Date.parse(position.updatedAt);
      events.push({
        id: `${position.position}-update-${position.updatedAt}`,
        type: "update",
        source: "position",
        timestamp: position.updatedAt,
        timestampMs: ts,
        ...base,
      });
    }

    if (position.closeAt) {
      const ts = Date.parse(position.closeAt);
      events.push({
        id: `${position.position}-close-${position.closeAt}`,
        type: "close",
        source: "position",
        timestamp: position.closeAt,
        timestampMs: ts,
        ...base,
      });
    }
  }

  return events;
}

function normalizeLogEvents(
  payload: unknown,
  owner: string,
  position: string,
  pairName: string,
  token0Symbol: string,
  token1Symbol: string,
  fallbackLogo0: string,
  fallbackLogo1: string,
  pool: string,
): TimelineEvent[] {
  if (!isRecord(payload)) {
    return [];
  }

  const entries = asArray<Record<string, unknown>>(payload.data);
  const events: TimelineEvent[] = [];

  for (const [index, entry] of entries.entries()) {
    const timestamp = toIsoOrNull(entry.timestamp);
    if (!timestamp) {
      continue;
    }

    const action = String(entry.action ?? "").trim().toLowerCase();
    const txHash = String(entry.txHash ?? "").trim();
    const ts = Date.parse(timestamp);
    const logo0 = toCleanString(entry.logo0) || fallbackLogo0;
    const logo1 = toCleanString(entry.logo1) || fallbackLogo1;

    events.push({
      id: `${position}-${txHash || "nohash"}-${index}`,
      type: action || "log",
      source: "log",
      timestamp,
      timestampMs: ts,
      owner,
      pairName,
      token0Symbol,
      token1Symbol,
      logo0: logo0 || undefined,
      logo1: logo1 || undefined,
      pool,
      position,
      status: "Log",
      pnlNative: 0,
      valueNative: 0,
      feeNative: 0,
      txHash: txHash || undefined,
      action: action || undefined,
      amount0: toNumber(entry.amount0),
      amount1: toNumber(entry.amount1),
      nativePrice: toNumber(entry.nativePrice),
    });
  }

  return events;
}

async function fetchLogsForPositions(
  owner: string,
  positions: PositionRecord[],
  maxLogPositions: number,
): Promise<LogsFetchResult> {
  const byNewestCreated = [...positions].sort((a, b) => {
    return parseTimestamp(b.createdAt) - parseTimestamp(a.createdAt);
  });

  const selected = Array.from(
    new Map(
      byNewestCreated
        .filter((item) => item.position)
        .map((item) => [item.position, item]),
    ).values(),
  ).slice(0, maxLogPositions);

  if (selected.length === 0) {
    return {
      events: [],
      requestedPositions: 0,
      fetchedPositions: 0,
      failedPositions: 0,
    };
  }

  const settled = await Promise.allSettled(
    selected.map((item) =>
      withRateLimitRetry(
        () => fetchLpLogs(owner, "SOL", item.position),
        1,
      ).then((payload) => ({
        item,
        payload,
      })),
    ),
  );

  const events: TimelineEvent[] = [];
  let fetchedPositions = 0;
  let failedPositions = 0;

  for (const result of settled) {
    if (result.status === "fulfilled") {
      fetchedPositions += 1;
      const { item, payload } = result.value;
      events.push(
        ...normalizeLogEvents(
          payload,
          owner,
          item.position,
          item.pairName,
          item.token0Symbol,
          item.token1Symbol,
          item.logo0,
          item.logo1,
          item.pool,
        ),
      );
    } else {
      failedPositions += 1;
    }
  }

  return {
    events,
    requestedPositions: selected.length,
    fetchedPositions,
    failedPositions,
  };
}

function pickOverviewList(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload)) {
    return [];
  }

  return asArray<Record<string, unknown>>(payload.data);
}

function pickArrayData(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload)) {
    return [];
  }

  return asArray<Record<string, unknown>>(payload.data);
}

function pickAllMetric(value: unknown): number {
  if (typeof value === "number" || typeof value === "string") {
    return toNumber(value);
  }

  if (!isRecord(value)) {
    return 0;
  }

  if ("ALL" in value) {
    return toNumber(value.ALL);
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

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function computeMedian(values: number[]): number {
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

function computeHoldHours(position: PositionRecord, nowMs: number): number | null {
  if (!position.createdAt) {
    return null;
  }

  const startMs = Date.parse(position.createdAt);
  if (Number.isNaN(startMs)) {
    return null;
  }

  const endCandidate = position.closeAt ?? position.updatedAt;
  const endMs = endCandidate ? Date.parse(endCandidate) : nowMs;
  if (Number.isNaN(endMs) || endMs <= startMs) {
    return null;
  }

  return (endMs - startMs) / 3_600_000;
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

  if (
    (token0Stable && token1Major) ||
    (token1Stable && token0Major)
  ) {
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

function buildOverviewAggregate(overview: Record<string, unknown>[]): OverviewAggregate {
  const protocols = new Set<string>();
  let totalLp = 0;
  let openingLp = 0;
  let closedLp = 0;
  let totalPool = 0;
  let totalPnlNative = 0;
  let totalFeeNative = 0;
  let weightedWinNumerator = 0;
  let weightedWinBase = 0;
  let firstActivityMs = Number.POSITIVE_INFINITY;
  let lastActivityMs = 0;

  for (const item of overview) {
    const protocol = toCleanString(item.protocol);
    if (protocol) {
      protocols.add(protocol);
    }

    const itemTotalLp = toNumber(item.total_lp);
    const itemOpeningLp = toNumber(item.opening_lp);
    const itemClosedLp = pickAllMetric(item.closed_lp);
    const itemTotalPool = toNumber(item.total_pool);
    const itemPnlNative = pickAllMetric(item.total_pnl_native);
    const itemFeeNative = pickAllMetric(item.total_fee_native);
    const itemWinRate = pickAllMetric(item.win_rate_native);

    totalLp += itemTotalLp;
    openingLp += itemOpeningLp;
    closedLp += itemClosedLp;
    totalPool += itemTotalPool;
    totalPnlNative += itemPnlNative;
    totalFeeNative += itemFeeNative;

    const weight = itemClosedLp > 0 ? itemClosedLp : itemTotalLp;
    if (weight > 0) {
      weightedWinNumerator += itemWinRate * weight;
      weightedWinBase += weight;
    }

    const firstActivity = toIsoOrNull(item.first_activity);
    const lastActivity = toIsoOrNull(item.last_activity);

    if (firstActivity) {
      const ts = Date.parse(firstActivity);
      if (!Number.isNaN(ts)) {
        firstActivityMs = Math.min(firstActivityMs, ts);
      }
    }

    if (lastActivity) {
      const ts = Date.parse(lastActivity);
      if (!Number.isNaN(ts)) {
        lastActivityMs = Math.max(lastActivityMs, ts);
      }
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
      weightedWinBase > 0 ? weightedWinNumerator / weightedWinBase : 0,
    weightedWinBase,
    uniqueProtocols: protocols.size,
    firstActivity:
      Number.isFinite(firstActivityMs) && firstActivityMs !== Number.POSITIVE_INFINITY
        ? new Date(firstActivityMs).toISOString()
        : null,
    lastActivity: lastActivityMs > 0 ? new Date(lastActivityMs).toISOString() : null,
  };
}

function buildSummary(
  owner: string,
  positions: PositionRecord[],
  timeline: TimelineEvent[],
  overview: Record<string, unknown>[],
): WalletSummary {
  const openingFromPositions = positions.filter((item) => {
    const status = item.status.toLowerCase();
    return status.includes("open") && !status.includes("close") && !item.closeAt;
  });

  const closedFromPositions = positions.filter((item) => {
    return item.status.toLowerCase().includes("close") || Boolean(item.closeAt);
  });

  const uniquePoolsFromPositions = new Set(
    positions.map((item) => item.pool).filter((pool) => pool.trim() !== ""),
  );

  const uniqueProtocolsFromPositions = new Set(
    positions
      .map((item) => item.protocol)
      .filter((protocol) => protocol.trim() !== ""),
  );

  const overviewAggregate = buildOverviewAggregate(overview);
  const hasOverview = overview.length > 0;

  const totalPositions = hasOverview
    ? overviewAggregate.totalLp
    : positions.length;
  const openingPositions = hasOverview
    ? overviewAggregate.openingLp
    : openingFromPositions.length;
  const closedPositions = hasOverview
    ? overviewAggregate.closedLp
    : closedFromPositions.length;
  const uniquePools = hasOverview
    ? overviewAggregate.totalPool
    : uniquePoolsFromPositions.size;
  const uniqueProtocols = hasOverview
    ? overviewAggregate.uniqueProtocols
    : uniqueProtocolsFromPositions.size;
  const totalPnlNative = hasOverview
    ? overviewAggregate.totalPnlNative
    : positions.reduce((sum, item) => sum + item.pnlNative, 0);
  const totalFeeNative = hasOverview
    ? overviewAggregate.totalFeeNative
    : positions.reduce((sum, item) => sum + item.feeNative, 0);

  const winRate = hasOverview
    ? overviewAggregate.winRateNative
    : closedPositions > 0
      ? closedFromPositions.filter((item) => item.pnlNative > 0).length /
        closedPositions
      : 0;

  const winCount = Math.max(0, Math.round(closedPositions * winRate));
  const lossCount = Math.max(0, closedPositions - winCount);
  const positivePnlRatio = winRate;
  const avgClosedPnlNative =
    closedPositions > 0
      ? totalPnlNative / closedPositions
      : 0;

  const sortedTimeline = [...timeline].sort((a, b) => a.timestampMs - b.timestampMs);
  const firstActivityFromTimeline = sortedTimeline[0]?.timestamp ?? null;
  const lastActivityFromTimeline =
    sortedTimeline[sortedTimeline.length - 1]?.timestamp ?? null;
  const firstActivity =
    (hasOverview ? overviewAggregate.firstActivity : null) ??
    firstActivityFromTimeline;
  const lastActivity =
    (hasOverview ? overviewAggregate.lastActivity : null) ??
    lastActivityFromTimeline;

  return {
    owner,
    totalPositions,
    openingPositions,
    closedPositions,
    uniquePools,
    uniqueProtocols,
    totalPnlNative,
    totalFeeNative,
    winRate,
    winCount,
    lossCount,
    positivePnlRatio,
    avgClosedPnlNative,
    firstActivity,
    lastActivity,
  };
}

function buildInsights(summary: WalletSummary, positions: PositionRecord[]): WalletInsights {
  const nowMs = Date.now();

  const closedPositions = positions.filter((position) => Boolean(position.closeAt));
  const holdSource = closedPositions.length > 0 ? closedPositions : positions;
  const holdHours = holdSource
    .map((position) => computeHoldHours(position, nowMs))
    .filter((value): value is number => value !== null);

  const averageHoldHours =
    holdHours.length > 0
      ? holdHours.reduce((sum, value) => sum + value, 0) / holdHours.length
      : 0;
  const medianHoldHours = computeMedian(holdHours);
  const scalpPositions = holdHours.filter(
    (value) => value <= HOLD_THRESHOLD_HOURS,
  ).length;
  const swingPositions = holdHours.filter(
    (value) => value > HOLD_THRESHOLD_HOURS,
  ).length;

  const strategyType: StrategyInsight["type"] =
    holdHours.length === 0
      ? "UNKNOWN"
      : averageHoldHours <= HOLD_THRESHOLD_HOURS
        ? "SCALP"
        : "SWING";

  const counts: Record<TokenCategory, number> = {
    stable_stable: 0,
    stable_major: 0,
    stable_alt: 0,
    major_major: 0,
    alt_speculative: 0,
  };

  for (const position of positions) {
    counts[classifyTokenCategory(position)] += 1;
  }

  const totalTokenPositions = positions.length;
  const dominantCategoryEntry = (
    Object.entries(counts) as Array<[TokenCategory, number]>
  ).sort((a, b) => b[1] - a[1])[0];
  const dominantCategory =
    totalTokenPositions > 0 && dominantCategoryEntry
      ? dominantCategoryEntry[0]
      : "unknown";

  const stableExposureRatio =
    totalTokenPositions > 0
      ? (counts.stable_stable + counts.stable_major + counts.stable_alt) /
        totalTokenPositions
      : 0;
  const speculativeExposureRatio =
    totalTokenPositions > 0 ? counts.alt_speculative / totalTokenPositions : 0;

  const pairCounter = new Map<string, number>();
  for (const position of positions) {
    const pair = position.pairName || "-";
    pairCounter.set(pair, (pairCounter.get(pair) ?? 0) + 1);
  }

  const topPairs = Array.from(pairCounter.entries())
    .map(([pair, count]) => ({ pair, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const profitIsGood =
    summary.totalPnlNative > 0 &&
    summary.winRate >= 0.55 &&
    summary.avgClosedPnlNative >= 0;
  const smartPoolSearch =
    summary.uniquePools >= 2 &&
    summary.positivePnlRatio >= 0.55 &&
    summary.closedPositions >= 2;

  const isSmart = profitIsGood && smartPoolSearch;

  const signalReasons: string[] = [];
  if (profitIsGood) {
    signalReasons.push("Lợi nhuận tổng dương và win rate ổn.");
  } else {
    signalReasons.push("Lợi nhuận hoặc win rate chưa đủ tốt.");
  }

  if (smartPoolSearch) {
    signalReasons.push("Có dấu hiệu chọn pool hiệu quả và ổn định.");
  } else {
    signalReasons.push("Khả năng chọn pool thông minh chưa rõ hoặc còn yếu.");
  }

  const insightWarnings: string[] = [];
  if (summary.totalPnlNative < 0) {
    insightWarnings.push("Cảnh báo: tổng PnL đang âm.");
  }
  if (summary.winRate < 0.5) {
    insightWarnings.push("Cảnh báo: win rate dưới 50%.");
  }
  if (speculativeExposureRatio >= 0.6) {
    insightWarnings.push(
      "Cảnh báo: tỷ trọng token rủi ro cao (alt/speculative) đang lớn.",
    );
  }
  if (strategyType === "SCALP" && averageHoldHours < 1) {
    insightWarnings.push(
      "Cảnh báo: vòng đời LP rất ngắn, dễ bị nhiễu thị trường và phí.",
    );
  }
  if (strategyType === "UNKNOWN") {
    insightWarnings.push(
      "Chưa đủ dữ liệu đóng vị thế để kết luận rõ Scalp hay Swing.",
    );
  }

  return {
    strategy: {
      type: strategyType,
      thresholdHours: HOLD_THRESHOLD_HOURS,
      averageHoldHours,
      medianHoldHours,
      scalpPositions,
      swingPositions,
      sampledPositions: holdHours.length,
    },
    tokenMix: {
      totalPositions: totalTokenPositions,
      counts,
      dominantCategory,
      stableExposureRatio,
      speculativeExposureRatio,
      topPairs,
    },
    signal: {
      isSmart,
      status: isSmart ? "GREEN_TICK" : "RED_X",
      symbol: isSmart ? "✓" : "✕",
      label: isSmart
        ? "Ví có hiệu suất tốt, thiên hướng chọn pool thông minh."
        : "Ví chưa cho thấy hiệu suất hoặc chọn pool đủ tốt.",
      reasons: signalReasons,
    },
    warnings: insightWarnings,
  };
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
    MAX_PAGE_SIZE,
  );
  const maxPages = normalizeNumberParam(
    url.searchParams.get("maxPages"),
    DEFAULT_MAX_PAGES,
    1,
    MAX_MAX_PAGES,
  );
  const includeLogs = normalizeBooleanParam(
    url.searchParams.get("includeLogs"),
    DEFAULT_INCLUDE_LOGS,
  );
  const logPositions = normalizeNumberParam(
    url.searchParams.get("logPositions"),
    DEFAULT_LOG_POSITIONS,
    0,
    MAX_LOG_POSITIONS,
  );

  try {
    const warnings: ApiWarning[] = [];
    let overviewRaw: unknown = null;

    try {
      overviewRaw = await withRateLimitRetry(
        () => fetchLpOverview(owner),
        4,
      );
    } catch (error) {
      const info = extractAxiosErrorInfo(error);
      warnings.push({
        source: "overview",
        status: info.status,
        message:
          info.status === 429
            ? "Overview đang bị rate-limit. Tổng PnL tạm thời sẽ ước tính từ dữ liệu position đã tải."
            : info.message,
      });
    }

    const historicalResult = await fetchAllHistoricalPositions(
      owner,
      pageSize,
      maxPages,
    );

    if (historicalResult.stoppedReason === "rate_limited") {
      warnings.push({
        source: "historical",
        status: 429,
        message:
          "Historical positions bị rate-limit, đang trả dữ liệu partial.",
      });
    }

    const [openingSettled, revenueSettled, tokenBalanceSettled] =
      await Promise.allSettled([
        withRateLimitRetry(() => fetchLpOpeningPositions(owner)),
        withRateLimitRetry(() => fetchLpRevenue(owner)),
        withRateLimitRetry(() => fetchTokenBalances(owner)),
      ]);

    const openingRaw =
      openingSettled.status === "fulfilled" ? openingSettled.value : null;
    const revenueRaw =
      revenueSettled.status === "fulfilled" ? revenueSettled.value : null;
    const tokenBalanceRaw =
      tokenBalanceSettled.status === "fulfilled"
        ? tokenBalanceSettled.value
        : null;

    if (openingSettled.status === "rejected") {
      const info = extractAxiosErrorInfo(openingSettled.reason);
      warnings.push({
        source: "opening",
        status: info.status,
        message: info.message,
      });
    }

    if (revenueSettled.status === "rejected") {
      const info = extractAxiosErrorInfo(revenueSettled.reason);
      warnings.push({
        source: "revenue",
        status: info.status,
        message: info.message,
      });
    }

    if (tokenBalanceSettled.status === "rejected") {
      const info = extractAxiosErrorInfo(tokenBalanceSettled.reason);
      warnings.push({
        source: "token_balance",
        status: info.status,
        message: info.message,
      });
    }

    const openingPositions = extractOpeningItems(openingRaw, owner);
    const allPositions = dedupePositions([
      ...historicalResult.items,
      ...openingPositions,
    ]);

    const positionTimeline = createPositionTimeline(allPositions);
    const logResult =
      includeLogs && logPositions > 0
        ? await fetchLogsForPositions(owner, allPositions, logPositions)
        : {
            events: [] as TimelineEvent[],
            requestedPositions: 0,
            fetchedPositions: 0,
            failedPositions: 0,
          };

    if (includeLogs && logResult.failedPositions > 0) {
      warnings.push({
        source: "logs",
        status: 429,
        message:
          "Một phần log position bị rate-limit hoặc lỗi upstream, đang hiển thị log partial.",
      });
    }

    const timeline = [...positionTimeline, ...logResult.events]
      .filter((item) => Number.isFinite(item.timestampMs) && item.timestampMs > 0)
      .sort((a, b) => b.timestampMs - a.timestampMs);

    if (
      historicalResult.totalPages > 1 &&
      historicalResult.pagesFetched < historicalResult.totalPages
    ) {
      const hasOverview = pickOverviewList(overviewRaw).length > 0;
      warnings.push({
        source: "historical",
        message: hasOverview
          ? `Dữ liệu position đang là mẫu ${historicalResult.pagesFetched}/${historicalResult.totalPages} trang (do giới hạn maxPages), nhưng PnL tổng đã lấy từ overview để đảm bảo chính xác.`
          : `Dữ liệu position đang là mẫu ${historicalResult.pagesFetched}/${historicalResult.totalPages} trang (do giới hạn maxPages), nên PnL tổng hiện là ước tính.`,
      });
    }

    const overviewList = pickOverviewList(overviewRaw);
    const summary = buildSummary(owner, allPositions, timeline, overviewList);
    const insights = buildInsights(summary, allPositions);

    for (const text of insights.warnings) {
      warnings.push({
        source: "analysis",
        message: text,
      });
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      owner,
      summary,
      insights,
      timeline,
      positions: allPositions,
      overview: overviewList,
      revenue: pickArrayData(revenueRaw),
      tokenBalances: pickArrayData(tokenBalanceRaw),
      warnings,
      meta: {
        pageSize,
        maxPages,
        includeLogs,
        logPositions,
        summary: {
          pnlSource: overviewList.length > 0 ? "overview" : "positions_sample",
        },
        historical: {
          pagesFetched: historicalResult.pagesFetched,
          totalPages: historicalResult.totalPages,
          records: historicalResult.items.length,
          stoppedReason: historicalResult.stoppedReason ?? null,
        },
        openingRecords: openingPositions.length,
        logs: {
          requestedPositions: logResult.requestedPositions,
          fetchedPositions: logResult.fetchedPositions,
          failedPositions: logResult.failedPositions,
          events: logResult.events.length,
        },
      },
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 500;
      const defaultMessage =
        status === 429
          ? "Meteora Data API đang rate-limit (429). Hãy thử lại sau vài giây hoặc giảm maxPages/includeLogs."
          : error.message;

      return NextResponse.json(
        {
          message: error.response?.data?.message || defaultMessage,
          status,
          upstream: error.response?.data ?? null,
        },
        { status },
      );
    }

    const message =
      error instanceof Error ? error.message : "Unexpected server error";

    return NextResponse.json(
      {
        message,
      },
      { status: 500 },
    );
  }
}
