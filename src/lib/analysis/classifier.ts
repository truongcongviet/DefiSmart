import {
  fetchLpHistoricalPositions,
  fetchLpOpeningPositions,
  fetchLpOverview,
  fetchLpRevenue,
  getWalletLpSourceStatus,
} from "@/lib/api/lp-data";
import {
  asArray,
  avg,
  clamp,
  getNested,
  isRecord,
  safeRatio,
  toNumber,
} from "@/lib/utils";

import type {
  SourceStatus,
  WalletClassificationResult,
  WalletMetrics,
  WalletSegment,
  WalletTier,
} from "./types";

const WALLET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
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

interface OverviewAggregate {
  protocols: Set<string>;
  totalLp: number;
  openingLp: number;
  closedLp: number;
  totalPnlUsd: number;
  totalFeeUsd: number;
  winRate: number;
  roi: number;
  apr: number;
}

export function isValidWalletAddress(wallet: string): boolean {
  return WALLET_REGEX.test(wallet.trim());
}

function extractPayload(result: PromiseSettledResult<unknown>): unknown {
  return result.status === "fulfilled" ? result.value : undefined;
}

function pickPeriodMetric(value: unknown, preferredKey = "ALL"): number {
  if (typeof value === "number" || typeof value === "string") {
    return toNumber(value);
  }

  if (!isRecord(value)) {
    return 0;
  }

  const preferred = value[preferredKey];
  if (preferred !== undefined) {
    return toNumber(preferred);
  }

  for (const key of ["1M", "30D", "7D", "3M", "YTD", "1Y"]) {
    if (value[key] !== undefined) {
      return toNumber(value[key]);
    }
  }

  for (const nestedValue of Object.values(value)) {
    const parsed = toNumber(nestedValue);
    if (parsed !== 0) {
      return parsed;
    }
  }

  return 0;
}

function normalizeSymbol(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }

  return raw.trim().toUpperCase();
}

function extractPairSymbols(item: unknown): [string, string] {
  const tokenA = normalizeSymbol(
    getNested(item, ["tokenName0"]) ??
      getNested(item, ["token0Info", "token_symbol"]) ??
      getNested(item, ["tokenX"]) ??
      getNested(item, ["token_x", "symbol"]),
  );

  const tokenB = normalizeSymbol(
    getNested(item, ["tokenName1"]) ??
      getNested(item, ["token1Info", "token_symbol"]) ??
      getNested(item, ["tokenY"]) ??
      getNested(item, ["token_y", "symbol"]),
  );

  if (tokenA && tokenB) {
    return [tokenA, tokenB];
  }

  const pairName = normalizeSymbol(getNested(item, ["pairName"]));
  if (pairName.includes("-")) {
    const [left, right] = pairName.split("-").map((part) => part.trim());
    if (left && right) {
      return [left, right];
    }
  }

  return [tokenA, tokenB];
}

function extractPoolAddress(item: unknown): string {
  return (
    String(
      getNested(item, ["pool"]) ??
        getNested(item, ["poolAddress"]) ??
        getNested(item, ["pool_address"]) ??
        "",
    ) || ""
  );
}

function extractAgeHour(item: unknown): number {
  const fromAgeHour = toNumber(getNested(item, ["ageHour"]));
  if (fromAgeHour > 0) {
    return fromAgeHour;
  }

  const createdAt = getNested(item, ["createdAt"]);
  if (typeof createdAt === "string") {
    const timestamp = Date.parse(createdAt);
    if (!Number.isNaN(timestamp)) {
      return Math.max(0, (Date.now() - timestamp) / 3_600_000);
    }
  }

  return 0;
}

function aggregateOverview(rawOverview: unknown): OverviewAggregate {
  const rawData = isRecord(rawOverview) ? rawOverview.data : undefined;
  const entries = asArray<Record<string, unknown>>(rawData);

  const protocols = new Set<string>();
  let totalLp = 0;
  let openingLp = 0;
  let closedLp = 0;
  let totalPnlUsd = 0;
  let totalFeeUsd = 0;
  let weightedWinRate = 0;
  let weightedWinWeight = 0;

  const roiValues: number[] = [];
  const aprValues: number[] = [];

  for (const entry of entries) {
    const protocol = String(entry.protocol ?? "").trim();
    if (protocol) {
      protocols.add(protocol);
    }

    const entryTotalLp = toNumber(entry.total_lp);
    const entryOpeningLp = toNumber(entry.opening_lp);
    const entryClosedLp = pickPeriodMetric(entry.closed_lp);
    const entryWinRate = pickPeriodMetric(entry.win_rate);

    totalLp += entryTotalLp;
    openingLp += entryOpeningLp;
    closedLp += entryClosedLp;
    totalPnlUsd += pickPeriodMetric(entry.total_pnl);
    totalFeeUsd += pickPeriodMetric(entry.total_fee);

    const weight = entryTotalLp > 0 ? entryTotalLp : 1;
    weightedWinRate += entryWinRate * weight;
    weightedWinWeight += weight;

    const roi = toNumber(entry.roi);
    if (roi !== 0) {
      roiValues.push(roi);
    }

    const apr = toNumber(entry.apr);
    if (apr !== 0) {
      aprValues.push(apr);
    }
  }

  return {
    protocols,
    totalLp,
    openingLp,
    closedLp,
    totalPnlUsd,
    totalFeeUsd,
    winRate: weightedWinWeight > 0 ? weightedWinRate / weightedWinWeight : 0,
    roi: avg(roiValues),
    apr: avg(aprValues),
  };
}

function inferSegment(metrics: WalletMetrics): {
  segment: WalletSegment;
  rationale: string[];
} {
  if (
    metrics.turnoverRatio > 1.05 &&
    metrics.winRate < 0.45 &&
    metrics.totalPnlUsd < 0
  ) {
    return {
      segment: "High-Risk Spinner",
      rationale: [
        "Turnover rất cao nhưng tỷ lệ thắng thấp.",
        "Lợi nhuận tổng đang âm, dấu hiệu quản trị rủi ro chưa ổn.",
      ],
    };
  }

  if (metrics.uniquePools >= 8 && metrics.protocolsUsed >= 2) {
    return {
      segment: "Diversified Multi-Protocol",
      rationale: [
        "Phân bổ nhiều pool và nhiều protocol, giảm phụ thuộc một kèo.",
        "Mẫu hành vi phù hợp wallet đi theo chiến lược phân tán rủi ro.",
      ],
    };
  }

  if (
    metrics.stableExposureRatio >= 0.6 &&
    metrics.turnoverRatio <= 0.65 &&
    metrics.totalFeeUsd > 0
  ) {
    return {
      segment: "Stable Yield Farmer",
      rationale: [
        "Tỷ trọng cặp có stable cao, thiên về dòng tiền ổn định.",
        "Turnover vừa phải, ưu tiên fee + compounding hơn giao dịch xoay vòng.",
      ],
    };
  }

  if (
    metrics.turnoverRatio >= 0.75 &&
    metrics.winRate >= 0.5 &&
    metrics.revenueTrendPct > 0
  ) {
    return {
      segment: "Momentum Rotator",
      rationale: [
        "Xoay vòng vị thế nhanh nhưng vẫn giữ được xác suất thắng tốt.",
        "Xu hướng revenue gần đây dương, phản ánh timing tương đối ổn.",
      ],
    };
  }

  if (
    metrics.turnoverRatio >= 0.8 ||
    (metrics.avgPositionAgeHours > 0 && metrics.avgPositionAgeHours < 72)
  ) {
    return {
      segment: "Active Rebalancer",
      rationale: [
        "Tần suất đóng/mở vị thế cao, nghiêng về chiến lược rebalance chủ động.",
        "Hành vi phù hợp wallet theo sát biến động và tái phân bổ liên tục.",
      ],
    };
  }

  if (metrics.uniquePools <= 2 && Math.abs(metrics.totalPnlUsd) > 1_000) {
    return {
      segment: "Concentrated Conviction",
      rationale: [
        "Tập trung vốn vào rất ít pool, thể hiện niềm tin cao vào một vài cặp.",
        "Biên độ PnL lớn hơn mức trung bình nên profile rủi ro/lợi nhuận cao hơn.",
      ],
    };
  }

  return {
    segment: "Balanced LP Farmer",
    rationale: [
      "Danh mục và nhịp xoay vị thế ở mức cân bằng.",
      "Không có dấu hiệu quá lệch sang high-risk hoặc quá phòng thủ.",
    ],
  };
}

function scoreWallet(
  metrics: WalletMetrics,
  segment: WalletSegment,
  sourceStatus: SourceStatus,
): number {
  let score = 50;

  score += clamp((metrics.winRate - 0.5) * 80, -20, 20);

  if (metrics.totalPnlUsd > 0) {
    score += clamp(Math.log10(metrics.totalPnlUsd + 1) * 6, 0, 15);
  } else if (metrics.totalPnlUsd < 0) {
    score -= clamp(Math.log10(Math.abs(metrics.totalPnlUsd) + 1) * 6, 0, 15);
  }

  score += clamp(Math.log10(Math.max(metrics.totalFeeUsd, 1)) * 4 - 4, -8, 12);

  if (metrics.uniquePools >= 4 && metrics.uniquePools <= 20) {
    score += 6;
  } else if (metrics.uniquePools <= 1) {
    score -= 6;
  }

  if (metrics.outOfRangeRatio <= 0.2) {
    score += 8;
  } else if (metrics.outOfRangeRatio >= 0.6) {
    score -= 10;
  }

  if (metrics.turnoverRatio >= 0.15 && metrics.turnoverRatio <= 0.8) {
    score += 4;
  } else if (metrics.turnoverRatio > 1.05) {
    score -= 7;
  }

  if (metrics.protocolsUsed >= 2) {
    score += 6;
  }

  if (metrics.stableExposureRatio >= 0.4) {
    score += 3;
  }

  if (segment === "High-Risk Spinner") {
    score -= 12;
  }

  if (
    segment === "Stable Yield Farmer" ||
    segment === "Diversified Multi-Protocol"
  ) {
    score += 6;
  }

  const sourceCoverage = Object.values(sourceStatus).filter(Boolean).length;
  score += clamp(sourceCoverage - 4, -5, 5);

  return Math.round(clamp(score, 0, 100));
}

function scoreConfidence(
  sourceStatus: SourceStatus,
  metrics: WalletMetrics,
): number {
  const sourceCoverage = Object.values(sourceStatus).filter(Boolean).length;
  let confidence = 40 + (sourceCoverage / 7) * 60;

  if (metrics.openPositions + metrics.historicalPositions === 0) {
    confidence -= 15;
  }

  return Math.round(clamp(confidence, 10, 100));
}

function toTier(score: number): WalletTier {
  if (score >= 75) {
    return "Smart LP";
  }

  if (score >= 55) {
    return "Watchlist";
  }

  return "Risky";
}

function buildSummary(
  wallet: string,
  segment: WalletSegment,
  metrics: WalletMetrics,
): string {
  const shortWallet = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;

  return `${shortWallet} thuộc nhóm ${segment}, win rate ${(
    metrics.winRate * 100
  ).toFixed(1)}% và tổng PnL ~$${metrics.totalPnlUsd.toFixed(2)}.`;
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

export async function classifyWallet(
  wallet: string,
): Promise<WalletClassificationResult> {
  const normalizedWallet = wallet.trim();

  if (!isValidWalletAddress(normalizedWallet)) {
    throw new Error(`Invalid Solana wallet address: ${wallet}`);
  }

  const [
    lpOverviewResult,
    lpOpeningResult,
    lpHistoricalResult,
    lpRevenueResult,
    lpSourceResult,
  ] = await Promise.allSettled([
    fetchLpOverview(normalizedWallet),
    fetchLpOpeningPositions(normalizedWallet),
    fetchLpHistoricalPositions(normalizedWallet),
    fetchLpRevenue(normalizedWallet),
    getWalletLpSourceStatus(normalizedWallet),
  ]);

  const lpSources =
    lpSourceResult.status === "fulfilled"
      ? lpSourceResult.value
      : { dlmm: false, dammOpen: false, dammClosed: false };

  const sourceStatus: SourceStatus = {
    lpOverview: lpOverviewResult.status === "fulfilled",
    lpOpening: lpOpeningResult.status === "fulfilled",
    lpHistorical: lpHistoricalResult.status === "fulfilled",
    lpRevenue: lpRevenueResult.status === "fulfilled",
    meteoraDlmm: lpSources.dlmm,
    meteoraDammOpen: lpSources.dammOpen,
    meteoraDammClosed: lpSources.dammClosed,
  };

  const lpOverviewRaw = extractPayload(lpOverviewResult);
  const lpOpeningRaw = extractPayload(lpOpeningResult);
  const lpHistoricalRaw = extractPayload(lpHistoricalResult);
  const lpRevenueRaw = extractPayload(lpRevenueResult);

  const overview = aggregateOverview(lpOverviewRaw);
  const lpOpeningItems = asArray<Record<string, unknown>>(
    getNested(lpOpeningRaw, ["data"]),
  );

  const lpHistoricalContainer = getNested(lpHistoricalRaw, ["data"]);
  const lpHistoricalItems = asArray<Record<string, unknown>>(
    getNested(lpHistoricalContainer, ["data"]),
  );

  const lpHistoricalPagination = getNested(lpHistoricalContainer, [
    "pagination",
  ]);
  const lpHistoricalTotalCount = toNumber(
    getNested(lpHistoricalPagination, ["totalCount"]),
  );

  const revenueItems = asArray<Record<string, unknown>>(
    getNested(lpRevenueRaw, ["data"]),
  );
  // Meteora DLMM / DAMM v2 positions already arrive through the LP data
  // layer above, so there is nothing extra to merge here.
  const dlmmPools: Record<string, unknown>[] = [];
  const dammOpenItems: Record<string, unknown>[] = [];
  const dammClosedItems: Record<string, unknown>[] = [];

  const allPoolAddresses = uniqueNonEmpty([
    ...lpOpeningItems.map(extractPoolAddress),
    ...lpHistoricalItems.map(extractPoolAddress),
    ...dlmmPools.map(extractPoolAddress),
    ...dammOpenItems.map(extractPoolAddress),
    ...dammClosedItems.map(extractPoolAddress),
  ]);

  const protocolCandidates = uniqueNonEmpty([
    ...Array.from(overview.protocols),
    ...lpOpeningItems.map((item) => String(item.protocol ?? "")),
    ...lpHistoricalItems.map((item) => String(item.protocol ?? "")),
    dlmmPools.length > 0 ? "meteora-dlmm" : "",
    dammOpenItems.length > 0 || dammClosedItems.length > 0
      ? "meteora-damm-v2"
      : "",
  ]);

  const lpOpenCount = lpOpeningItems.length;
  const dlmmOpenCount = dlmmPools.reduce(
    (sum, pool) => sum + Math.max(1, toNumber(pool.openPositionCount ?? 0)),
    0,
  );
  const dammOpenCount = dammOpenItems.length;

  const openPositions = lpOpenCount + dlmmOpenCount + dammOpenCount;

  const historicalPositions = Math.max(
    lpHistoricalTotalCount + dammClosedItems.length,
    lpHistoricalItems.length + dammClosedItems.length,
  );

  const closedLp =
    overview.closedLp > 0 ? overview.closedLp : historicalPositions;
  const totalLp =
    overview.totalLp > 0 ? overview.totalLp : closedLp + openPositions;

  const turnoverRatio = safeRatio(closedLp, totalLp);

  const outOfRangeFromLp = lpOpeningItems.filter(
    (item) => item.inRange === false,
  ).length;
  const outOfRangeFromDlmm = dlmmPools.reduce(
    (sum, pool) =>
      sum + asArray(getNested(pool, ["positionsOutOfRange"])).length,
    0,
  );
  const outOfRangeRatio = safeRatio(
    outOfRangeFromLp + outOfRangeFromDlmm,
    openPositions,
  );

  const lpAgeHours = lpOpeningItems
    .map(extractAgeHour)
    .filter((value) => value > 0);
  const avgPositionAgeHours = avg(lpAgeHours);

  const pairSources = [
    ...lpOpeningItems,
    ...lpHistoricalItems.slice(0, 60),
    ...dlmmPools,
    ...dammOpenItems,
    ...dammClosedItems.slice(0, 60),
  ];

  let stablePairCount = 0;
  let totalPairCount = 0;

  for (const source of pairSources) {
    const [tokenA, tokenB] = extractPairSymbols(source);
    if (!tokenA && !tokenB) {
      continue;
    }

    totalPairCount += 1;
    if (STABLE_SYMBOLS.has(tokenA) || STABLE_SYMBOLS.has(tokenB)) {
      stablePairCount += 1;
    }
  }

  const stableExposureRatio = safeRatio(stablePairCount, totalPairCount);

  const winRateFallbackData = [
    ...lpHistoricalItems.map((item) => pickPeriodMetric(item.pnl)),
    ...dammClosedItems.map((item) => toNumber(item.pnl)),
  ];
  const winRateFallback = safeRatio(
    winRateFallbackData.filter((pnl) => pnl > 0).length,
    winRateFallbackData.length,
  );

  const winRate = overview.winRate > 0 ? overview.winRate : winRateFallback;

  const dlmmPnl = dlmmPools.reduce((sum, pool) => sum + toNumber(pool.pnl), 0);
  const dammOpenPnl = dammOpenItems.reduce(
    (sum, position) => sum + toNumber(position.unrealized_pnl),
    0,
  );
  const dammClosedPnl = dammClosedItems.reduce(
    (sum, position) => sum + toNumber(position.pnl),
    0,
  );

  let totalPnlUsd = overview.totalPnlUsd;
  if (totalPnlUsd === 0) {
    totalPnlUsd = dlmmPnl + dammOpenPnl + dammClosedPnl;
  } else {
    totalPnlUsd += dammClosedPnl * 0.25 + dammOpenPnl * 0.15;
  }

  const revenueTrendCandidates = revenueItems
    .slice(-30)
    .map((item) => toNumber(item.pnl_percent))
    .filter((value) => Number.isFinite(value));
  const revenueTrendPct = avg(revenueTrendCandidates);

  const metrics: WalletMetrics = {
    uniquePools: allPoolAddresses.length,
    protocolsUsed: protocolCandidates.length,
    openPositions,
    historicalPositions,
    turnoverRatio,
    outOfRangeRatio,
    stableExposureRatio,
    avgPositionAgeHours,
    winRate,
    totalPnlUsd,
    totalFeeUsd: overview.totalFeeUsd,
    roi: overview.roi,
    apr: overview.apr,
    revenueTrendPct,
  };

  const { segment, rationale } = inferSegment(metrics);
  const smartScore = scoreWallet(metrics, segment, sourceStatus);
  const confidence = scoreConfidence(sourceStatus, metrics);
  const tier = toTier(smartScore);

  return {
    wallet: normalizedWallet,
    tier,
    segment,
    smartScore,
    confidence,
    summary: buildSummary(normalizedWallet, segment, metrics),
    rationale: [
      ...rationale,
      `Win rate: ${(metrics.winRate * 100).toFixed(1)}%, turnover: ${metrics.turnoverRatio.toFixed(
        2,
      )}`,
      `Pools: ${metrics.uniquePools}, protocols: ${metrics.protocolsUsed}, stable exposure: ${(
        metrics.stableExposureRatio * 100
      ).toFixed(1)}%`,
    ],
    metrics,
    sourceStatus,
    generatedAt: new Date().toISOString(),
  };
}
