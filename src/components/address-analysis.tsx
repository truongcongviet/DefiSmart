"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Search } from "lucide-react";

import { WalletTradesPanel } from "@/components/wallet-trades-panel";
import { cn } from "@/lib/utils";

const WALLET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface AnalysisSummary {
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

interface AnalysisTimelineEvent {
  id: string;
  type: string;
  source: "position" | "log";
  timestamp: string;
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
}

interface AddressAnalysisResponse {
  owner: string;
  generatedAt: string;
  summary: AnalysisSummary;
  overview?: Array<Record<string, unknown>>;
  revenue?: Array<Record<string, unknown>>;
  tokenBalances?: Array<Record<string, unknown>>;
  insights?: {
    strategy: {
      type: "SCALP" | "SWING" | "UNKNOWN";
      thresholdHours: number;
      averageHoldHours: number;
      medianHoldHours: number;
      scalpPositions: number;
      swingPositions: number;
      sampledPositions: number;
    };
    tokenMix: {
      totalPositions: number;
      counts: {
        stable_stable: number;
        stable_major: number;
        stable_alt: number;
        major_major: number;
        alt_speculative: number;
      };
      dominantCategory:
        | "stable_stable"
        | "stable_major"
        | "stable_alt"
        | "major_major"
        | "alt_speculative"
        | "unknown";
      stableExposureRatio: number;
      speculativeExposureRatio: number;
      topPairs: Array<{ pair: string; count: number }>;
    };
    signal: {
      isSmart: boolean;
      status: "GREEN_TICK" | "RED_X";
      symbol: "✓" | "✕";
      label: string;
      reasons: string[];
    };
    warnings: string[];
  };
  timeline: AnalysisTimelineEvent[];
  warnings?: Array<{
    source: string;
    status?: number;
    message: string;
  }>;
  meta?: {
    logs?: {
      requestedPositions?: number;
      fetchedPositions?: number;
      failedPositions?: number;
      events?: number;
    };
  };
}

interface ErrorPayload {
  message?: string;
}

interface WalletScoreResponse {
  generatedAt: string;
  owner: string;
  tier: "Smart LP" | "Watchlist" | "Risky";
  totalScore: number;
  breakdown: {
    profit: number;
    stability: number;
    risk: number;
    poolSelection: number;
  };
  confidence: {
    value: number;
    level: "HIGH" | "MEDIUM" | "LOW";
    reasons: string[];
  };
  summary: {
    totalPositions: number;
    openingPositions: number;
    closedPositions: number;
    uniquePools: number;
    totalPnlNative: number;
    totalFeeNative: number;
    winRate: number;
    avgClosedPnlNative: number;
  };
  tokenMix: {
    totalPositions: number;
    stableExposureRatio: number;
    speculativeExposureRatio: number;
  };
  reasons: string[];
  warnings?: Array<{
    source: string;
    status?: number;
    message: string;
  }>;
}

interface TradeTimeDistributionResponse {
  owner: string;
  generatedAt: string;
  buckets: Array<{
    key: "morning" | "noon" | "afternoon" | "night";
    label: string;
    range: string;
    count: number;
  }>;
  totalTrades: number;
  minAbsPnlNative?: number;
  processedPositions: number;
  qualifiedPositions?: number;
  validTimestampPositions: number;
  totalExpected: number;
  isPartial: boolean;
  coverageRatio: number;
  meta?: {
    pagesFetched?: number;
    totalPages?: number;
    stoppedReason?: string | null;
  };
  warnings?: string[];
}

interface MeteoraPoolToken {
  symbol?: string;
  icon?: string;
  warnings?: unknown[];
  top_holders_pct?: number;
  organic_score?: number;
}

interface MeteoraPoolItem {
  name?: string;
  pool_address?: string;
  token_x?: MeteoraPoolToken;
  token_y?: MeteoraPoolToken;
  volume?: number;
  active_tvl?: number;
  fee_active_tvl_ratio?: number;
  unique_lps?: number;
  active_positions?: number;
  volatility?: number;
  permanent_lock_liquidity_pct?: number;
  base_token_has_critical_warnings?: boolean;
  quote_token_has_critical_warnings?: boolean;
  base_token_has_high_single_ownership?: boolean;
  quote_token_has_high_single_ownership?: boolean;
}

interface MeteoraPoolsResponse {
  total?: number;
  pools?: MeteoraPoolItem[];
  message?: string;
}

type AnalysisOptionKey =
  | "wallet_pool_fit"
  | "pool_opportunity"
  | "execution_quality"
  | "crowding_heatmap"
  | "risk_radar"
  | "regime_analysis"
  | "copy_simulation"
  | "trade_time"
  | "timeline";

const ANALYSIS_OPTIONS: Array<{
  key: AnalysisOptionKey;
  label: string;
  description: string;
}> = [
  {
    key: "wallet_pool_fit",
    label: "Wallet-Pool Fit",
    description: "Độ phù hợp giữa style ví và pool.",
  },
  {
    key: "pool_opportunity",
    label: "Pool Opportunity",
    description: "Xếp hạng pool có tiềm năng cao.",
  },
  {
    key: "execution_quality",
    label: "Execution Quality",
    description: "Hiệu suất thực chiến của ví.",
  },
  {
    key: "crowding_heatmap",
    label: "Crowding Heatmap",
    description: "Pool nào đang crowded.",
  },
  {
    key: "risk_radar",
    label: "Risk Radar",
    description: "Rủi ro token/pool hiện tại.",
  },
  {
    key: "regime_analysis",
    label: "Regime Analysis",
    description: "Hiệu suất theo 7D/1M/3M.",
  },
  {
    key: "copy_simulation",
    label: "Copy Simulation",
    description: "Ước tính follow strategy.",
  },
  {
    key: "trade_time",
    label: "Trade Time",
    description: "Phân bổ lệnh theo 4 khung giờ.",
  },
  {
    key: "timeline",
    label: "Timeline",
    description: "Lịch sử lệnh chi tiết.",
  },
];

const CORE_OPTIONS: AnalysisOptionKey[] = [
  "wallet_pool_fit",
  "execution_quality",
  "risk_radar",
  "regime_analysis",
  "copy_simulation",
  "timeline",
];

const METEORA_OPTIONS: AnalysisOptionKey[] = [
  "wallet_pool_fit",
  "pool_opportunity",
  "crowding_heatmap",
  "risk_radar",
];

const MIN_VISIBLE_PNL_SOL = 0.01;

function formatNumber(value: number, maxFractionDigits = 2) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatSol(value: number) {
  return `${formatNumber(value, 2)} SOL`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function scoreTextClass(score: number) {
  if (score >= 75) {
    return "text-emerald-400";
  }

  if (score >= 50) {
    return "text-amber-300";
  }

  return "text-rose-400";
}

function tierBadgeClass(tier: WalletScoreResponse["tier"]) {
  if (tier === "Smart LP") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }

  if (tier === "Watchlist") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  }

  return "border-rose-500/40 bg-rose-500/10 text-rose-300";
}

function confidenceBadgeClass(
  level: WalletScoreResponse["confidence"]["level"],
) {
  if (level === "HIGH") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }

  if (level === "MEDIUM") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  }

  return "border-rose-500/40 bg-rose-500/10 text-rose-300";
}

function formatHours(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }

  return `${value.toFixed(2)}h`;
}

function tokenCategoryLabel(
  value:
    | "stable_stable"
    | "stable_major"
    | "stable_alt"
    | "major_major"
    | "alt_speculative"
    | "unknown",
) {
  switch (value) {
    case "stable_stable":
      return "Stable/Stable";
    case "stable_major":
      return "Stable/Major";
    case "stable_alt":
      return "Stable/Alt";
    case "major_major":
      return "Major/Major";
    case "alt_speculative":
      return "Alt/Speculative";
    default:
      return "Unknown";
  }
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    return value;
  }

  return new Date(ts).toLocaleString();
}

function shorten(value: string, head = 6, tail = 4) {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function getEventBadgeClass(type: string) {
  const normalized = type.toLowerCase();

  if (normalized.includes("open") || normalized.includes("increase")) {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }

  if (normalized.includes("close") || normalized.includes("decrease")) {
    return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  }

  if (normalized.includes("update")) {
    return "border-cyan-500/40 bg-cyan-500/10 text-cyan-300";
  }

  return "border-zinc-700 bg-zinc-800/60 text-zinc-300";
}

function initialFromSymbol(symbol: string) {
  const normalized = symbol.trim();
  if (!normalized) {
    return "?";
  }

  return normalized[0].toUpperCase();
}

function getPairLabel(event: AnalysisTimelineEvent) {
  const token0 = event.token0Symbol?.trim();
  const token1 = event.token1Symbol?.trim();

  if (token0 && token1) {
    return `${token0}/${token1}`;
  }

  return event.pairName || token0 || token1 || "-";
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function splitPairSymbols(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return [] as string[];
  }

  for (const separator of ["/", "-", "_"]) {
    if (normalized.includes(separator)) {
      return normalized
        .split(separator)
        .map((item) => item.trim())
        .filter((item) => item !== "")
        .slice(0, 2);
    }
  }

  return normalized.split(/\s+/).filter(Boolean).slice(0, 2);
}

function getPoolPairLabel(pool: MeteoraPoolItem) {
  const tokenX = asString(pool.token_x?.symbol);
  const tokenY = asString(pool.token_y?.symbol);

  if (tokenX && tokenY) {
    return `${tokenX}/${tokenY}`;
  }

  return asString(pool.name) || "-";
}

function getPoolSymbols(pool: MeteoraPoolItem) {
  const tokenX = normalizeSymbol(asString(pool.token_x?.symbol));
  const tokenY = normalizeSymbol(asString(pool.token_y?.symbol));

  if (tokenX && tokenY) {
    return [tokenX, tokenY] as string[];
  }

  return splitPairSymbols(getPoolPairLabel(pool));
}

function poolMatchesSymbols(pool: MeteoraPoolItem, symbols: string[]) {
  if (symbols.length === 0) {
    return false;
  }

  const poolSymbols = getPoolSymbols(pool);
  if (symbols.length === 1) {
    return poolSymbols.includes(symbols[0]);
  }

  return poolSymbols.includes(symbols[0]) && poolSymbols.includes(symbols[1]);
}

function poolOpportunityScore(pool: MeteoraPoolItem) {
  const feeRatio = asNumber(pool.fee_active_tvl_ratio);
  const volume = asNumber(pool.volume);
  const activeTvl = asNumber(pool.active_tvl);
  const volatility = asNumber(pool.volatility);

  const feeComponent = feeRatio * 6;
  const volumeComponent = Math.log10(volume + 1) * 3;
  const tvlComponent = Math.log10(activeTvl + 1) * 2;
  const volatilityPenalty = volatility * 0.25;

  return feeComponent + volumeComponent + tvlComponent - volatilityPenalty;
}

function countTokenWarnings(token: MeteoraPoolToken | undefined) {
  if (!token || !Array.isArray(token.warnings)) {
    return 0;
  }

  return token.warnings.length;
}

function pickPeriodMetric(value: unknown, period: "ALL" | "7D" | "1M" | "3M") {
  if (typeof value === "number" || typeof value === "string") {
    return asNumber(value);
  }

  if (!value || typeof value !== "object") {
    return 0;
  }

  const source = value as Record<string, unknown>;

  if (period in source) {
    return asNumber(source[period]);
  }

  if ("ALL" in source) {
    return asNumber(source.ALL);
  }

  const fallbackKeys = ["1M", "30D", "7D", "3M", "YTD", "1Y"];
  for (const key of fallbackKeys) {
    if (key in source) {
      const parsed = asNumber(source[key]);
      if (parsed !== 0) {
        return parsed;
      }
    }
  }

  return 0;
}

interface TimeBucketStat {
  key: "morning" | "noon" | "afternoon" | "night";
  label: string;
  range: string;
  colorHex: string;
  dotClass: string;
  count: number;
}

function isPositionOpenEvent(event: AnalysisTimelineEvent) {
  return event.source === "position" && event.type.toLowerCase() === "open";
}

function getBaseTimeBuckets(): TimeBucketStat[] {
  return [
    {
      key: "morning",
      label: "Sáng",
      range: "00:00 - 05:59",
      colorHex: "#22d3ee",
      dotClass: "bg-cyan-400",
      count: 0,
    },
    {
      key: "noon",
      label: "Trưa",
      range: "06:00 - 11:59",
      colorHex: "#f59e0b",
      dotClass: "bg-amber-400",
      count: 0,
    },
    {
      key: "afternoon",
      label: "Chiều",
      range: "12:00 - 17:59",
      colorHex: "#34d399",
      dotClass: "bg-emerald-400",
      count: 0,
    },
    {
      key: "night",
      label: "Tối",
      range: "18:00 - 23:59",
      colorHex: "#fb7185",
      dotClass: "bg-rose-400",
      count: 0,
    },
  ];
}

function buildConicGradient(buckets: TimeBucketStat[], total: number) {
  if (total <= 0) {
    return "conic-gradient(#27272a 0deg 360deg)";
  }

  let current = 0;
  const segments = buckets.map((bucket) => {
    const ratio = bucket.count / total;
    const next = current + ratio * 360;
    const segment = `${bucket.colorHex} ${current.toFixed(2)}deg ${next.toFixed(2)}deg`;
    current = next;
    return segment;
  });

  return `conic-gradient(${segments.join(", ")})`;
}

function TokenIcon({ symbol, logoUrl }: { symbol: string; logoUrl?: string }) {
  const [isBroken, setIsBroken] = useState(false);
  const showImage = Boolean(logoUrl && !isBroken);

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={symbol || "token"}
        className="h-5 w-5 rounded-full border border-zinc-700 bg-zinc-900 object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setIsBroken(true)}
      />
    );
  }

  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-[10px] font-semibold text-zinc-300">
      {initialFromSymbol(symbol)}
    </span>
  );
}

const inputClassName =
  "h-11 w-full rounded-lg border border-rule bg-paper-2 px-3 font-mono text-sm text-ink outline-none transition placeholder:text-muted hover:border-rule-2 focus:border-accent";

export function AddressAnalysis({
  initialOwner = "",
}: {
  initialOwner?: string;
}) {
  const [address, setAddress] = useState(initialOwner);
  const [analyzedOwner, setAnalyzedOwner] = useState("");
  const [activeOption, setActiveOption] =
    useState<AnalysisOptionKey>("execution_quality");
  const [result, setResult] = useState<AddressAnalysisResponse | null>(null);
  const [walletScore, setWalletScore] = useState<WalletScoreResponse | null>(
    null,
  );
  const [walletScoreError, setWalletScoreError] = useState("");
  const [isWalletScoreLoading, setIsWalletScoreLoading] = useState(false);
  const [isCoreLoading, setIsCoreLoading] = useState(false);
  const [meteoraPools, setMeteoraPools] = useState<MeteoraPoolItem[] | null>(
    null,
  );
  const [meteoraPoolsError, setMeteoraPoolsError] = useState("");
  const [isMeteoraPoolsLoading, setIsMeteoraPoolsLoading] = useState(false);
  const [timeDistribution, setTimeDistribution] =
    useState<TradeTimeDistributionResponse | null>(null);
  const [timeDistributionError, setTimeDistributionError] = useState("");
  const [isTimeDistributionLoading, setIsTimeDistributionLoading] =
    useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const trimmedAddress = address.trim();
  const isInvalidAddress =
    trimmedAddress.length > 0 && !WALLET_REGEX.test(trimmedAddress);

  const activeOptionMeta = useMemo(() => {
    return ANALYSIS_OPTIONS.find((item) => item.key === activeOption) ?? null;
  }, [activeOption]);

  const metrics = useMemo(() => {
    if (!result) {
      return [] as Array<{ label: string; value: string; accent?: string }>;
    }

    const summary = result.summary;

    return [
      {
        label: "Total Positions",
        value: formatNumber(summary.totalPositions, 0),
      },
      {
        label: "Open / Closed",
        value: `${formatNumber(summary.openingPositions, 0)} / ${formatNumber(summary.closedPositions, 0)}`,
      },
      {
        label: "Unique Pools",
        value: formatNumber(summary.uniquePools, 0),
      },
      {
        label: "Win Rate (Closed)",
        value: formatPercent(summary.winRate),
      },
      {
        label: "Total PnL",
        value: formatSol(summary.totalPnlNative),
        accent:
          summary.totalPnlNative > 0
            ? "text-emerald-400"
            : summary.totalPnlNative < 0
              ? "text-rose-400"
              : "text-zinc-100",
      },
      {
        label: "Total Fee",
        value: formatSol(summary.totalFeeNative),
      },
      {
        label: "First Activity",
        value: formatDateTime(summary.firstActivity),
      },
      {
        label: "Last Activity",
        value: formatDateTime(summary.lastActivity),
      },
    ];
  }, [result]);

  useEffect(() => {
    if (!analyzedOwner || !isWalletScoreLoading) {
      return;
    }

    if (walletScore?.owner === analyzedOwner) {
      return;
    }

    let isCanceled = false;

    fetch(
      `/api/analysis/wallet-score?owner=${encodeURIComponent(analyzedOwner)}&pageSize=50&maxPages=3`,
    )
      .then(async (response) => {
        const payload = (await response.json()) as WalletScoreResponse &
          ErrorPayload;

        if (!response.ok) {
          throw new Error(
            payload.message || "Failed to calculate wallet score.",
          );
        }

        if (!isCanceled) {
          setWalletScore(payload);
        }
      })
      .catch((error) => {
        if (isCanceled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unexpected client error";
        setWalletScoreError(message);
        setWalletScore(null);
      })
      .finally(() => {
        if (!isCanceled) {
          setIsWalletScoreLoading(false);
        }
      });

    return () => {
      isCanceled = true;
    };
  }, [analyzedOwner, walletScore?.owner, isWalletScoreLoading]);

  useEffect(() => {
    if (!analyzedOwner || !isCoreLoading) {
      return;
    }

    if (result?.owner === analyzedOwner) {
      return;
    }

    let isCanceled = false;

    const params = new URLSearchParams({
      owner: analyzedOwner,
      pageSize: "50",
      maxPages: "3",
      includeLogs: "false",
    });

    fetch(`/api/lpagent/address-analysis?${params.toString()}`)
      .then(async (response) => {
        const payload = (await response.json()) as AddressAnalysisResponse &
          ErrorPayload;

        if (!response.ok) {
          throw new Error(payload.message || "Failed to analyze this address.");
        }

        if (!isCanceled) {
          setResult(payload);
        }
      })
      .catch((error) => {
        if (isCanceled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unexpected client error";
        setErrorMessage(message);
        setResult(null);
      })
      .finally(() => {
        if (!isCanceled) {
          setIsCoreLoading(false);
        }
      });

    return () => {
      isCanceled = true;
    };
  }, [analyzedOwner, result?.owner, isCoreLoading]);

  useEffect(() => {
    if (!analyzedOwner || !isTimeDistributionLoading) {
      return;
    }

    if (timeDistribution?.owner === analyzedOwner) {
      return;
    }

    let isCanceled = false;

    fetch(
      `/api/lpagent/trade-time-distribution?owner=${encodeURIComponent(analyzedOwner)}&minAbsPnlNative=${MIN_VISIBLE_PNL_SOL}`,
    )
      .then(async (response) => {
        const payload =
          (await response.json()) as TradeTimeDistributionResponse &
            ErrorPayload;

        if (!response.ok) {
          throw new Error(
            payload.message || "Failed to fetch trade time distribution.",
          );
        }

        if (!isCanceled) {
          setTimeDistribution(payload);
        }
      })
      .catch((error) => {
        if (isCanceled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unexpected client error";
        setTimeDistributionError(message);
      })
      .finally(() => {
        if (!isCanceled) {
          setIsTimeDistributionLoading(false);
        }
      });

    return () => {
      isCanceled = true;
    };
  }, [analyzedOwner, timeDistribution?.owner, isTimeDistributionLoading]);

  useEffect(() => {
    if (!analyzedOwner || !isMeteoraPoolsLoading) {
      return;
    }

    if (meteoraPools) {
      return;
    }

    let isCanceled = false;

    fetch("/api/meteora/pools-snapshot")
      .then(async (response) => {
        const payload = (await response.json()) as MeteoraPoolsResponse;
        if (!response.ok) {
          throw new Error(payload.message || "Failed to fetch Meteora pools.");
        }

        if (!isCanceled) {
          setMeteoraPools(Array.isArray(payload.pools) ? payload.pools : []);
        }
      })
      .catch((error) => {
        if (isCanceled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unexpected client error";
        setMeteoraPoolsError(message);
      })
      .finally(() => {
        if (!isCanceled) {
          setIsMeteoraPoolsLoading(false);
        }
      });

    return () => {
      isCanceled = true;
    };
  }, [analyzedOwner, meteoraPools, isMeteoraPoolsLoading]);

  const tradeTimeStats = useMemo(() => {
    const buckets = getBaseTimeBuckets();

    if (timeDistribution) {
      const countMap = new Map(
        timeDistribution.buckets.map((bucket) => [bucket.key, bucket.count]),
      );

      for (const bucket of buckets) {
        bucket.count = countMap.get(bucket.key) ?? 0;
      }

      return {
        buckets,
        totalTrades: timeDistribution.totalTrades,
        totalExpected: timeDistribution.totalExpected,
        coverageRatio: timeDistribution.coverageRatio,
        isPartial: timeDistribution.isPartial,
        source: "historical_full_scan" as const,
        warnings: Array.isArray(timeDistribution.warnings)
          ? timeDistribution.warnings
          : [],
        gradient: buildConicGradient(buckets, timeDistribution.totalTrades),
      };
    }

    if (!result) {
      return {
        buckets,
        totalTrades: 0,
        totalExpected: 0,
        coverageRatio: 0,
        isPartial: false,
        source: "empty" as const,
        warnings: [] as string[],
        gradient: buildConicGradient(buckets, 0),
      };
    }

    for (const event of result.timeline) {
      if (!isPositionOpenEvent(event)) {
        continue;
      }
      if (Math.abs(event.pnlNative) < MIN_VISIBLE_PNL_SOL) {
        continue;
      }

      const timestamp = Date.parse(event.timestamp);
      if (Number.isNaN(timestamp)) {
        continue;
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
    }

    const totalTrades = buckets.reduce((sum, item) => sum + item.count, 0);
    const totalExpected = Math.max(0, result.summary.totalPositions);
    const coverageRatio = totalExpected > 0 ? totalTrades / totalExpected : 0;

    return {
      buckets,
      totalTrades,
      totalExpected,
      coverageRatio,
      isPartial: true,
      source: "timeline_sample" as const,
      warnings: [] as string[],
      gradient: buildConicGradient(buckets, totalTrades),
    };
  }, [result, timeDistribution]);

  const filteredTimeline = useMemo(() => {
    if (!result) {
      return [] as AnalysisTimelineEvent[];
    }

    return result.timeline.filter((event) => {
      return Math.abs(event.pnlNative) >= MIN_VISIBLE_PNL_SOL;
    });
  }, [result]);

  const poolOpportunityRows = useMemo(() => {
    if (!meteoraPools) {
      return [] as Array<{
        pool: MeteoraPoolItem;
        score: number;
      }>;
    }

    return meteoraPools
      .map((pool) => ({
        pool,
        score: poolOpportunityScore(pool),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }, [meteoraPools]);

  const crowdingRows = useMemo(() => {
    if (!meteoraPools) {
      return [] as Array<{
        pool: MeteoraPoolItem;
        uniqueLps: number;
        activePositions: number;
        crowdingRatio: number;
      }>;
    }

    return meteoraPools
      .map((pool) => {
        const uniqueLps = asNumber(pool.unique_lps);
        const activePositions = asNumber(pool.active_positions);

        return {
          pool,
          uniqueLps,
          activePositions,
          crowdingRatio: uniqueLps > 0 ? activePositions / uniqueLps : 0,
        };
      })
      .sort((a, b) => {
        if (b.uniqueLps !== a.uniqueLps) {
          return b.uniqueLps - a.uniqueLps;
        }
        return b.activePositions - a.activePositions;
      })
      .slice(0, 16);
  }, [meteoraPools]);

  const riskRows = useMemo(() => {
    if (!meteoraPools) {
      return [] as Array<{
        pool: MeteoraPoolItem;
        riskScore: number;
        warningCount: number;
        ownershipPct: number;
        reasons: string[];
      }>;
    }

    return meteoraPools
      .map((pool) => {
        const tokenWarningCount =
          countTokenWarnings(pool.token_x) + countTokenWarnings(pool.token_y);
        const ownershipPct = Math.max(
          asNumber(pool.token_x?.top_holders_pct),
          asNumber(pool.token_y?.top_holders_pct),
        );
        const volatility = asNumber(pool.volatility);
        const activeTvl = asNumber(pool.active_tvl);

        const reasons: string[] = [];
        if (tokenWarningCount > 0) {
          reasons.push(`Token warnings: ${tokenWarningCount}`);
        }
        if (ownershipPct >= 25) {
          reasons.push(`Top holder cao: ${ownershipPct.toFixed(1)}%`);
        }
        if (volatility >= 8) {
          reasons.push(`Biến động cao: ${volatility.toFixed(2)}`);
        }
        if (activeTvl < 15_000) {
          reasons.push("Active TVL thấp");
        }

        let riskScore = tokenWarningCount * 2;
        riskScore += ownershipPct >= 25 ? 2 : 0;
        riskScore += volatility >= 8 ? 2 : volatility >= 5 ? 1 : 0;
        riskScore += activeTvl < 15_000 ? 1 : 0;

        return {
          pool,
          riskScore,
          warningCount: tokenWarningCount,
          ownershipPct,
          reasons,
        };
      })
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 20);
  }, [meteoraPools]);

  const walletPoolFitData = useMemo(() => {
    if (!result || !meteoraPools) {
      return null;
    }

    const topPairs = result.insights?.tokenMix.topPairs ?? [];
    const rows = topPairs.map((item) => {
      const symbols = splitPairSymbols(item.pair);
      const matched = meteoraPools
        .filter((pool) => poolMatchesSymbols(pool, symbols))
        .map((pool) => ({
          pool,
          score: poolOpportunityScore(pool),
        }))
        .sort((a, b) => b.score - a.score);

      return {
        pair: item.pair,
        count: item.count,
        matchCount: matched.length,
        bestPool: matched[0]?.pool,
        bestScore: matched[0]?.score ?? 0,
      };
    });

    const matchedPairs = rows.filter((row) => row.matchCount > 0).length;
    const totalPairs = rows.length;
    const fitRatio = totalPairs > 0 ? matchedPairs / totalPairs : 0;

    return {
      rows,
      matchedPairs,
      totalPairs,
      fitRatio,
    };
  }, [result, meteoraPools]);

  const overviewRows = useMemo(() => {
    if (!result || !Array.isArray(result.overview)) {
      return [] as Array<{
        protocol: string;
        totalLp: number;
        totalPool: number;
        pnl7d: number;
        pnl1m: number;
        pnl3m: number;
        pnlAll: number;
        winRateAll: number;
      }>;
    }

    return result.overview.map((item, index) => ({
      protocol: asString(item.protocol) || `protocol_${index + 1}`,
      totalLp: asNumber(item.total_lp),
      totalPool: asNumber(item.total_pool),
      pnl7d: pickPeriodMetric(item.total_pnl_native, "7D"),
      pnl1m: pickPeriodMetric(item.total_pnl_native, "1M"),
      pnl3m: pickPeriodMetric(item.total_pnl_native, "3M"),
      pnlAll: pickPeriodMetric(item.total_pnl_native, "ALL"),
      winRateAll: pickPeriodMetric(item.win_rate_native, "ALL"),
    }));
  }, [result]);

  const regimeTotals = useMemo(() => {
    return overviewRows.reduce(
      (acc, row) => {
        acc.pnl7d += row.pnl7d;
        acc.pnl1m += row.pnl1m;
        acc.pnl3m += row.pnl3m;
        return acc;
      },
      {
        pnl7d: 0,
        pnl1m: 0,
        pnl3m: 0,
      },
    );
  }, [overviewRows]);

  const copySimulation = useMemo(() => {
    if (!result) {
      return null;
    }

    const closedTrades = Math.max(
      1,
      result.summary.closedPositions || result.summary.totalPositions,
    );
    const pnlPerTrade = result.summary.totalPnlNative / closedTrades;
    const projected20 = pnlPerTrade * 20;
    const projected50 = pnlPerTrade * 50;
    const projected100 = pnlPerTrade * 100;

    const stabilityScore =
      result.summary.winRate * 0.6 +
      (result.summary.totalPnlNative > 0 ? 0.25 : 0) +
      (result.summary.closedPositions >= 30 ? 0.15 : 0);

    return {
      pnlPerTrade,
      projected20,
      projected50,
      projected100,
      stabilityScore,
      closedTrades,
    };
  }, [result]);

  function optionReady(option: AnalysisOptionKey) {
    if (!analyzedOwner) {
      return false;
    }

    const requiresCore = CORE_OPTIONS.includes(option);
    const requiresMeteora = METEORA_OPTIONS.includes(option);
    const requiresTradeTime = option === "trade_time";

    if (requiresTradeTime) {
      return Boolean(
        timeDistribution && timeDistribution.owner === analyzedOwner,
      );
    }

    if (requiresCore && requiresMeteora) {
      return Boolean(result && result.owner === analyzedOwner && meteoraPools);
    }

    if (requiresCore) {
      return Boolean(result && result.owner === analyzedOwner);
    }

    if (requiresMeteora) {
      return Boolean(meteoraPools);
    }

    return false;
  }

  function buildStateCard(title: string, message: string, error?: string) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-paper-2 p-5">
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
          {title}
        </p>
        <p className="mt-2 text-sm text-zinc-300">{message}</p>
        {error && (
          <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        )}
      </section>
    );
  }

  function startAnalysis(owner: string) {
    if (!owner) {
      setErrorMessage("Vui lòng nhập wallet address.");
      setResult(null);
      setWalletScore(null);
      setAnalyzedOwner("");
      return;
    }

    if (!WALLET_REGEX.test(owner)) {
      setErrorMessage("Wallet không đúng định dạng Solana.");
      setResult(null);
      setWalletScore(null);
      setAnalyzedOwner("");
      return;
    }

    setErrorMessage("");
    setWalletScoreError("");
    setMeteoraPoolsError("");
    setTimeDistributionError("");
    setAnalyzedOwner(owner);
    setResult(null);
    setWalletScore(null);
    setTimeDistribution(null);
    setIsWalletScoreLoading(true);
    setIsCoreLoading(CORE_OPTIONS.includes(activeOption));
    setIsTimeDistributionLoading(activeOption === "trade_time");
    setIsMeteoraPoolsLoading(
      METEORA_OPTIONS.includes(activeOption) && !meteoraPools,
    );
  }

  async function handleAnalyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startAnalysis(trimmedAddress);
  }

  // Deep link: /analysis?owner=<wallet> runs the analysis on first render.
  const [autoRunOwner, setAutoRunOwner] = useState(initialOwner.trim());
  useEffect(() => {
    if (!autoRunOwner) {
      return;
    }
    setAutoRunOwner("");
    startAnalysis(autoRunOwner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunOwner]);

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // No-op when clipboard is unavailable.
    }
  }

  function handleSelectOption(option: AnalysisOptionKey) {
    setActiveOption(option);

    if (!analyzedOwner) {
      return;
    }

    if (!walletScore || walletScore.owner !== analyzedOwner) {
      setWalletScoreError("");
      setIsWalletScoreLoading(true);
    }

    const requiresCore = CORE_OPTIONS.includes(option);
    const requiresTradeTime = option === "trade_time";
    const requiresMeteora = METEORA_OPTIONS.includes(option);

    if (requiresCore && (!result || result.owner !== analyzedOwner)) {
      setErrorMessage("");
      setIsCoreLoading(true);
    }

    if (
      requiresTradeTime &&
      (!timeDistribution || timeDistribution.owner !== analyzedOwner)
    ) {
      setTimeDistributionError("");
      setIsTimeDistributionLoading(true);
    }

    if (requiresMeteora && !meteoraPools) {
      setMeteoraPoolsError("");
      setIsMeteoraPoolsLoading(true);
    }
  }

  const ownerBadgeValue = result?.owner || analyzedOwner;

  const optionContent: ReactNode = (() => {
    switch (activeOption) {
      case "execution_quality": {
        if (isCoreLoading && !result) {
          return buildStateCard(
            "Execution Quality",
            "Đang tải dữ liệu ví on-chain từ Meteora...",
          );
        }

        if (!result) {
          return buildStateCard(
            "Execution Quality",
            "Chọn ví và nhấn Analyze để bắt đầu phân tích option này.",
            errorMessage || undefined,
          );
        }

        return (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <article
                  key={metric.label}
                  className="rounded-xl border border-zinc-800 bg-paper-2 p-4"
                >
                  <p className="text-xs text-zinc-500">{metric.label}</p>
                  <p
                    className={cn(
                      "mt-2 text-base font-semibold text-zinc-100",
                      metric.accent,
                    )}
                  >
                    {metric.value}
                  </p>
                </article>
              ))}
            </section>

            {result.insights && (
              <section className="grid gap-3 lg:grid-cols-3">
                <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                  <p className="text-xs text-zinc-500">LP Style</p>
                  <p className="mt-2 text-lg font-semibold text-zinc-100">
                    {result.insights.strategy.type === "SCALP"
                      ? "Scalp LP"
                      : result.insights.strategy.type === "SWING"
                        ? "Swing LP"
                        : "Unknown"}
                  </p>
                  <p className="mt-2 text-sm text-zinc-300">
                    Avg hold:{" "}
                    {formatHours(result.insights.strategy.averageHoldHours)}
                    {" | "}
                    Median:{" "}
                    {formatHours(result.insights.strategy.medianHoldHours)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    Ngưỡng Scalp/Swing:{" "}
                    {result.insights.strategy.thresholdHours}h
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    Scalp: {result.insights.strategy.scalpPositions} | Swing:{" "}
                    {result.insights.strategy.swingPositions} | Samples:{" "}
                    {result.insights.strategy.sampledPositions}
                  </p>
                </article>

                <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                  <p className="text-xs text-zinc-500">Token Mix</p>
                  <p className="mt-2 text-lg font-semibold text-zinc-100">
                    {tokenCategoryLabel(
                      result.insights.tokenMix.dominantCategory,
                    )}
                  </p>
                  <p className="mt-2 text-sm text-zinc-300">
                    Stable exposure:{" "}
                    {formatPercent(
                      result.insights.tokenMix.stableExposureRatio,
                    )}
                  </p>
                  <p className="mt-1 text-sm text-zinc-300">
                    Speculative exposure:{" "}
                    {formatPercent(
                      result.insights.tokenMix.speculativeExposureRatio,
                    )}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300">
                      Stable/Stable:{" "}
                      {result.insights.tokenMix.counts.stable_stable}
                    </span>
                    <span className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300">
                      Stable/Major:{" "}
                      {result.insights.tokenMix.counts.stable_major}
                    </span>
                    <span className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300">
                      Stable/Alt: {result.insights.tokenMix.counts.stable_alt}
                    </span>
                    <span className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300">
                      Major/Major: {result.insights.tokenMix.counts.major_major}
                    </span>
                    <span className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300">
                      Alt/Spec:{" "}
                      {result.insights.tokenMix.counts.alt_speculative}
                    </span>
                  </div>
                </article>

                <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                  <p className="text-xs text-zinc-500">Smart Signal</p>
                  <p
                    className={cn(
                      "mt-1 text-3xl font-semibold",
                      result.insights.signal.isSmart
                        ? "text-emerald-400"
                        : "text-rose-400",
                    )}
                  >
                    {result.insights.signal.symbol}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-sm font-medium",
                      result.insights.signal.isSmart
                        ? "text-emerald-300"
                        : "text-rose-300",
                    )}
                  >
                    {result.insights.signal.label}
                  </p>
                  <div className="mt-2 space-y-1 text-xs text-zinc-300">
                    {result.insights.signal.reasons.map((reason, index) => (
                      <p key={`signal-reason-${index}`}>{reason}</p>
                    ))}
                  </div>
                </article>
              </section>
            )}
          </>
        );
      }

      case "regime_analysis": {
        if (isCoreLoading && !result) {
          return buildStateCard(
            "Regime Analysis",
            "Đang tải overview/revenue để phân tích theo giai đoạn...",
          );
        }

        if (!result) {
          return buildStateCard(
            "Regime Analysis",
            "Chưa có dữ liệu ví để phân tích theo 7D/1M/3M.",
            errorMessage || undefined,
          );
        }

        return (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                <p className="text-xs text-zinc-500">PnL 7D (overview)</p>
                <p
                  className={cn(
                    "mt-2 text-base font-semibold",
                    regimeTotals.pnl7d >= 0
                      ? "text-emerald-400"
                      : "text-rose-400",
                  )}
                >
                  {formatSol(regimeTotals.pnl7d)}
                </p>
              </article>
              <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                <p className="text-xs text-zinc-500">PnL 1M (overview)</p>
                <p
                  className={cn(
                    "mt-2 text-base font-semibold",
                    regimeTotals.pnl1m >= 0
                      ? "text-emerald-400"
                      : "text-rose-400",
                  )}
                >
                  {formatSol(regimeTotals.pnl1m)}
                </p>
              </article>
              <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                <p className="text-xs text-zinc-500">PnL 3M (overview)</p>
                <p
                  className={cn(
                    "mt-2 text-base font-semibold",
                    regimeTotals.pnl3m >= 0
                      ? "text-emerald-400"
                      : "text-rose-400",
                  )}
                >
                  {formatSol(regimeTotals.pnl3m)}
                </p>
              </article>
              <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                <p className="text-xs text-zinc-500">Win Rate (ALL)</p>
                <p className="mt-2 text-base font-semibold text-zinc-100">
                  {formatPercent(result.summary.winRate)}
                </p>
              </article>
            </section>

            <section className="overflow-x-auto rounded-xl border border-zinc-800 bg-paper-2">
              <table className="min-w-[840px] divide-y divide-zinc-800 text-sm">
                <thead className="bg-paper-3 text-xs text-muted uppercase">
                  <tr>
                    <th className="px-3 py-3 text-left">Protocol</th>
                    <th className="px-3 py-3 text-right">Total LP</th>
                    <th className="px-3 py-3 text-right">Total Pools</th>
                    <th className="px-3 py-3 text-right">PnL 7D</th>
                    <th className="px-3 py-3 text-right">PnL 1M</th>
                    <th className="px-3 py-3 text-right">PnL 3M</th>
                    <th className="px-3 py-3 text-right">Win Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {overviewRows.map((row) => (
                    <tr key={row.protocol}>
                      <td className="px-3 py-3 font-medium text-zinc-100">
                        {row.protocol}
                      </td>
                      <td className="px-3 py-3 text-right text-zinc-300">
                        {formatNumber(row.totalLp, 0)}
                      </td>
                      <td className="px-3 py-3 text-right text-zinc-300">
                        {formatNumber(row.totalPool, 0)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right",
                          row.pnl7d >= 0 ? "text-emerald-400" : "text-rose-400",
                        )}
                      >
                        {formatSol(row.pnl7d)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right",
                          row.pnl1m >= 0 ? "text-emerald-400" : "text-rose-400",
                        )}
                      >
                        {formatSol(row.pnl1m)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right",
                          row.pnl3m >= 0 ? "text-emerald-400" : "text-rose-400",
                        )}
                      >
                        {formatSol(row.pnl3m)}
                      </td>
                      <td className="px-3 py-3 text-right text-zinc-200">
                        {formatPercent(row.winRateAll)}
                      </td>
                    </tr>
                  ))}
                  {overviewRows.length === 0 && (
                    <tr>
                      <td
                        className="px-3 py-8 text-center text-zinc-500"
                        colSpan={7}
                      >
                        Chưa có dữ liệu overview theo protocol.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        );
      }

      case "copy_simulation": {
        if (isCoreLoading && !result) {
          return buildStateCard(
            "Copy Simulation",
            "Đang tải dữ liệu lịch sử để mô phỏng copy...",
          );
        }

        if (!result || !copySimulation) {
          return buildStateCard(
            "Copy Simulation",
            "Chưa có dữ liệu để mô phỏng.",
            errorMessage || undefined,
          );
        }

        return (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                <p className="text-xs text-zinc-500">PnL / trade</p>
                <p
                  className={cn(
                    "mt-2 text-base font-semibold",
                    copySimulation.pnlPerTrade >= 0
                      ? "text-emerald-400"
                      : "text-rose-400",
                  )}
                >
                  {formatSol(copySimulation.pnlPerTrade)}
                </p>
              </article>
              <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                <p className="text-xs text-zinc-500">Projected 20 trades</p>
                <p
                  className={cn(
                    "mt-2 text-base font-semibold",
                    copySimulation.projected20 >= 0
                      ? "text-emerald-400"
                      : "text-rose-400",
                  )}
                >
                  {formatSol(copySimulation.projected20)}
                </p>
              </article>
              <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                <p className="text-xs text-zinc-500">Projected 50 trades</p>
                <p
                  className={cn(
                    "mt-2 text-base font-semibold",
                    copySimulation.projected50 >= 0
                      ? "text-emerald-400"
                      : "text-rose-400",
                  )}
                >
                  {formatSol(copySimulation.projected50)}
                </p>
              </article>
              <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                <p className="text-xs text-zinc-500">Projected 100 trades</p>
                <p
                  className={cn(
                    "mt-2 text-base font-semibold",
                    copySimulation.projected100 >= 0
                      ? "text-emerald-400"
                      : "text-rose-400",
                  )}
                >
                  {formatSol(copySimulation.projected100)}
                </p>
              </article>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
              <p className="text-xs text-zinc-500 uppercase">Simulation Note</p>
              <p className="mt-2 text-sm text-zinc-300">
                Mô phỏng này lấy trung bình từ{" "}
                {formatNumber(copySimulation.closedTrades, 0)} lệnh đã đóng,
                chưa tính trượt giá, độ trễ vào lệnh và giới hạn vốn.
              </p>
              <p className="mt-2 text-sm text-zinc-300">
                Stability score: {formatPercent(copySimulation.stabilityScore)}
              </p>
              <p
                className={cn(
                  "mt-2 inline-flex rounded-md border px-2 py-1 text-xs font-medium",
                  result.insights?.signal.isSmart
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-rose-500/40 bg-rose-500/10 text-rose-300",
                )}
              >
                {result.insights?.signal.isSmart
                  ? "✓ Có thể theo dõi copy"
                  : "✕ Chưa phù hợp để copy"}
              </p>
            </section>
          </>
        );
      }

      case "trade_time": {
        return (
          <section className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
            <p className="text-xs text-zinc-500 uppercase">
              Trade Time Distribution (24h)
            </p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-100">
              Phân bổ số lệnh theo 4 khung giờ (mỗi khung 6h)
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              Đã lọc chỉ giữ lệnh có |PnL| &gt;= {MIN_VISIBLE_PNL_SOL} SOL.
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Nguồn:{" "}
              {tradeTimeStats.source === "historical_full_scan"
                ? tradeTimeStats.isPartial
                  ? "Historical scan (partial)"
                  : "Historical scan (full)"
                : tradeTimeStats.source === "timeline_sample"
                  ? "Timeline sample"
                  : "-"}
              {" | "}
              Coverage: {formatPercent(tradeTimeStats.coverageRatio)} (
              {formatNumber(tradeTimeStats.totalTrades, 0)}/
              {formatNumber(tradeTimeStats.totalExpected, 0)})
            </p>

            {isTimeDistributionLoading && (
              <p className="mt-2 inline-flex items-center gap-2 text-xs text-cyan-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Đang tải full distribution từ toàn bộ historical pages...
              </p>
            )}

            {timeDistributionError && (
              <p className="mt-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {timeDistributionError}
              </p>
            )}

            {tradeTimeStats.warnings.length > 0 && (
              <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                {tradeTimeStats.warnings.map((warning, index) => (
                  <p key={`time-warning-${index}`}>{warning}</p>
                ))}
              </div>
            )}

            <div className="mt-4 grid gap-5 md:grid-cols-[220px_1fr]">
              <div className="flex items-center justify-center">
                <div
                  className="relative h-44 w-44 rounded-full border border-zinc-800"
                  style={{ background: tradeTimeStats.gradient }}
                >
                  <div className="absolute inset-9 flex flex-col items-center justify-center rounded-full border border-zinc-800 bg-paper-3">
                    <p className="text-xl font-semibold text-zinc-100">
                      {formatNumber(tradeTimeStats.totalTrades, 0)}
                    </p>
                    <p className="text-[11px] text-zinc-400">trades</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {tradeTimeStats.buckets.map((bucket) => {
                  const ratio =
                    tradeTimeStats.totalTrades > 0
                      ? bucket.count / tradeTimeStats.totalTrades
                      : 0;

                  return (
                    <article
                      key={bucket.label}
                      className="rounded-xl border border-zinc-800 bg-paper-3 p-3"
                    >
                      <p className="inline-flex items-center gap-2 text-sm font-medium text-zinc-100">
                        <span
                          className={cn(
                            "h-2.5 w-2.5 rounded-full",
                            bucket.dotClass,
                          )}
                        />
                        {bucket.label}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {bucket.range}
                      </p>
                      <p className="mt-2 text-sm text-zinc-200">
                        {formatNumber(bucket.count, 0)} lệnh
                      </p>
                      <p className="text-xs text-zinc-400">
                        {formatPercent(ratio)}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        );
      }

      case "timeline": {
        if (isCoreLoading && !result) {
          return buildStateCard(
            "Timeline",
            "Đang tải lịch sử vị thế và timeline events...",
          );
        }

        return (
          <section className="overflow-x-auto rounded-xl border border-zinc-800 bg-paper-2">
            <div className="border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">
              Chỉ hiển thị lệnh có |PnL| &gt;= {MIN_VISIBLE_PNL_SOL} SOL.
            </div>
            <table className="min-w-[1040px] divide-y divide-zinc-800 text-sm">
              <thead className="bg-paper-3 text-xs text-muted uppercase">
                <tr>
                  <th className="px-3 py-3 text-left">Time</th>
                  <th className="px-3 py-3 text-left">Event</th>
                  <th className="px-3 py-3 text-left">Pair</th>
                  <th className="px-3 py-3 text-left">Pool</th>
                  <th className="px-3 py-3 text-left">Position</th>
                  <th className="px-3 py-3 text-right">PnL</th>
                  <th className="px-3 py-3 text-right">Value</th>
                  <th className="px-3 py-3 text-left">Source</th>
                  <th className="px-3 py-3 text-left">Tx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {filteredTimeline.map((event) => (
                  <tr key={event.id}>
                    <td className="px-3 py-3 text-zinc-300">
                      {formatDateTime(event.timestamp)}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2 py-1 text-xs font-medium",
                          getEventBadgeClass(event.type),
                        )}
                      >
                        {event.type}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-medium text-zinc-100">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center -space-x-1">
                          <TokenIcon
                            symbol={event.token0Symbol}
                            logoUrl={event.logo0}
                          />
                          {(event.token1Symbol || event.logo1) && (
                            <TokenIcon
                              symbol={event.token1Symbol}
                              logoUrl={event.logo1}
                            />
                          )}
                        </div>
                        <span>{getPairLabel(event)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-400">
                      {event.pool ? shorten(event.pool, 8, 8) : "-"}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-400">
                      {event.position ? shorten(event.position, 8, 8) : "-"}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 text-right",
                        event.pnlNative > 0
                          ? "text-emerald-400"
                          : event.pnlNative < 0
                            ? "text-rose-400"
                            : "text-zinc-300",
                      )}
                    >
                      {formatSol(event.pnlNative)}
                    </td>
                    <td className="px-3 py-3 text-right text-zinc-200">
                      {formatSol(event.valueNative)}
                    </td>
                    <td className="px-3 py-3 text-zinc-300">{event.source}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-400">
                      {event.txHash ? shorten(event.txHash, 8, 8) : "-"}
                    </td>
                  </tr>
                ))}
                {!result && (
                  <tr>
                    <td
                      className="px-3 py-8 text-center text-zinc-500"
                      colSpan={9}
                    >
                      Chưa có dữ liệu. Nhập một wallet address để bắt đầu phân
                      tích.
                    </td>
                  </tr>
                )}
                {result && filteredTimeline.length === 0 && (
                  <tr>
                    <td
                      className="px-3 py-8 text-center text-zinc-500"
                      colSpan={9}
                    >
                      Không có lệnh nào có |PnL| &gt;= {MIN_VISIBLE_PNL_SOL}{" "}
                      SOL.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        );
      }

      case "pool_opportunity": {
        if (isMeteoraPoolsLoading && !meteoraPools) {
          return buildStateCard(
            "Pool Opportunity",
            "Đang tải snapshot pool từ Meteora...",
          );
        }

        if (!meteoraPools) {
          return buildStateCard(
            "Pool Opportunity",
            "Chưa có dữ liệu Meteora pools.",
            meteoraPoolsError || undefined,
          );
        }

        return (
          <section className="overflow-x-auto rounded-xl border border-zinc-800 bg-paper-2">
            <table className="min-w-[1040px] divide-y divide-zinc-800 text-sm">
              <thead className="bg-paper-3 text-xs text-muted uppercase">
                <tr>
                  <th className="px-3 py-3 text-left">#</th>
                  <th className="px-3 py-3 text-left">Pair</th>
                  <th className="px-3 py-3 text-left">Pool</th>
                  <th className="px-3 py-3 text-right">Volume</th>
                  <th className="px-3 py-3 text-right">Active TVL</th>
                  <th className="px-3 py-3 text-right">Fee/TVL</th>
                  <th className="px-3 py-3 text-right">Opportunity Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {poolOpportunityRows.map((row, index) => (
                  <tr
                    key={`${row.pool.pool_address || row.pool.name || "pool"}-${index}`}
                  >
                    <td className="px-3 py-3 text-zinc-400">{index + 1}</td>
                    <td className="px-3 py-3 text-zinc-100">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center -space-x-1">
                          <TokenIcon
                            symbol={asString(row.pool.token_x?.symbol) || "?"}
                            logoUrl={row.pool.token_x?.icon}
                          />
                          <TokenIcon
                            symbol={asString(row.pool.token_y?.symbol) || "?"}
                            logoUrl={row.pool.token_y?.icon}
                          />
                        </div>
                        <span>{getPoolPairLabel(row.pool)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-400">
                      {row.pool.pool_address
                        ? shorten(row.pool.pool_address, 8, 8)
                        : "-"}
                    </td>
                    <td className="px-3 py-3 text-right text-zinc-200">
                      {formatNumber(asNumber(row.pool.volume), 2)}
                    </td>
                    <td className="px-3 py-3 text-right text-zinc-200">
                      {formatNumber(asNumber(row.pool.active_tvl), 2)}
                    </td>
                    <td className="px-3 py-3 text-right text-emerald-400">
                      {asNumber(row.pool.fee_active_tvl_ratio).toFixed(4)}
                    </td>
                    <td className="px-3 py-3 text-right text-zinc-200">
                      {row.score.toFixed(2)}
                    </td>
                  </tr>
                ))}
                {poolOpportunityRows.length === 0 && (
                  <tr>
                    <td
                      className="px-3 py-8 text-center text-zinc-500"
                      colSpan={7}
                    >
                      Không có pool phù hợp.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        );
      }

      case "crowding_heatmap": {
        if (isMeteoraPoolsLoading && !meteoraPools) {
          return buildStateCard(
            "Crowding Heatmap",
            "Đang tải dữ liệu crowding của pool...",
          );
        }

        if (!meteoraPools) {
          return buildStateCard(
            "Crowding Heatmap",
            "Chưa có dữ liệu Meteora pools.",
            meteoraPoolsError || undefined,
          );
        }

        const maxUniqueLps = Math.max(1, crowdingRows[0]?.uniqueLps ?? 0);

        return (
          <section className="grid gap-3 md:grid-cols-2">
            {crowdingRows.map((row, index) => {
              const width = Math.max(4, (row.uniqueLps / maxUniqueLps) * 100);

              return (
                <article
                  key={`${row.pool.pool_address || row.pool.name || "crowd"}-${index}`}
                  className="rounded-xl border border-zinc-800 bg-paper-2 p-4"
                >
                  <p className="text-sm font-semibold text-zinc-100">
                    {getPoolPairLabel(row.pool)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {row.pool.pool_address
                      ? shorten(row.pool.pool_address, 8, 8)
                      : "-"}
                  </p>
                  <div className="mt-3 h-2 rounded-full bg-zinc-800">
                    <div
                      className="h-2 rounded-full bg-cyan-400"
                      style={{ width: `${Math.min(100, width)}%` }}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <p className="text-zinc-400">
                      Unique LPs
                      <br />
                      <span className="text-zinc-100">
                        {formatNumber(row.uniqueLps, 0)}
                      </span>
                    </p>
                    <p className="text-zinc-400">
                      Active Pos
                      <br />
                      <span className="text-zinc-100">
                        {formatNumber(row.activePositions, 0)}
                      </span>
                    </p>
                    <p className="text-zinc-400">
                      Ratio
                      <br />
                      <span className="text-zinc-100">
                        {row.crowdingRatio.toFixed(2)}
                      </span>
                    </p>
                  </div>
                </article>
              );
            })}
          </section>
        );
      }

      case "risk_radar": {
        if (isMeteoraPoolsLoading && !meteoraPools) {
          return buildStateCard(
            "Risk Radar",
            "Đang tải dữ liệu rủi ro pool...",
          );
        }

        if (!meteoraPools) {
          return buildStateCard(
            "Risk Radar",
            "Chưa có dữ liệu Meteora pools.",
            meteoraPoolsError || undefined,
          );
        }

        return (
          <>
            {result?.insights?.warnings &&
              result.insights.warnings.length > 0 && (
                <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
                  <p className="text-xs font-medium tracking-wide uppercase">
                    Wallet Warnings
                  </p>
                  <div className="mt-2 space-y-1">
                    {result.insights.warnings.map((warning, index) => (
                      <p key={`risk-wallet-warning-${index}`}>{warning}</p>
                    ))}
                  </div>
                </section>
              )}

            <section className="overflow-x-auto rounded-xl border border-zinc-800 bg-paper-2">
              <table className="min-w-[940px] divide-y divide-zinc-800 text-sm">
                <thead className="bg-paper-3 text-xs text-muted uppercase">
                  <tr>
                    <th className="px-3 py-3 text-left">Pool</th>
                    <th className="px-3 py-3 text-right">Risk Score</th>
                    <th className="px-3 py-3 text-right">Warnings</th>
                    <th className="px-3 py-3 text-right">Top Holder %</th>
                    <th className="px-3 py-3 text-left">Reasons</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {riskRows.map((row, index) => (
                    <tr
                      key={`${row.pool.pool_address || row.pool.name || "risk"}-${index}`}
                    >
                      <td className="px-3 py-3 text-zinc-100">
                        {getPoolPairLabel(row.pool)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right font-medium",
                          row.riskScore >= 5
                            ? "text-rose-400"
                            : row.riskScore >= 3
                              ? "text-amber-300"
                              : "text-emerald-300",
                        )}
                      >
                        {row.riskScore}
                      </td>
                      <td className="px-3 py-3 text-right text-zinc-300">
                        {row.warningCount}
                      </td>
                      <td className="px-3 py-3 text-right text-zinc-300">
                        {row.ownershipPct.toFixed(2)}%
                      </td>
                      <td className="px-3 py-3 text-zinc-300">
                        {row.reasons.length > 0
                          ? row.reasons.join(" | ")
                          : "Ổn"}
                      </td>
                    </tr>
                  ))}
                  {riskRows.length === 0 && (
                    <tr>
                      <td
                        className="px-3 py-8 text-center text-zinc-500"
                        colSpan={5}
                      >
                        Không có dữ liệu risk.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        );
      }

      case "wallet_pool_fit": {
        const waitingCore = isCoreLoading && !result;
        const waitingPools = isMeteoraPoolsLoading && !meteoraPools;

        if (waitingCore || waitingPools) {
          return buildStateCard(
            "Wallet-Pool Fit",
            "Đang tải dữ liệu ví và pool để tính độ phù hợp...",
          );
        }

        if (!walletPoolFitData) {
          return buildStateCard(
            "Wallet-Pool Fit",
            "Chưa đủ dữ liệu để so khớp wallet-pool.",
            errorMessage || meteoraPoolsError || undefined,
          );
        }

        const fitIsGood =
          walletPoolFitData.fitRatio >= 0.6 &&
          Boolean(result?.insights?.signal.isSmart);

        return (
          <>
            <section className="grid gap-3 sm:grid-cols-3">
              <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                <p className="text-xs text-zinc-500">Matched Pairs</p>
                <p className="data mt-2 text-xl font-semibold text-zinc-100">
                  {walletPoolFitData.matchedPairs}/
                  {walletPoolFitData.totalPairs}
                </p>
              </article>
              <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                <p className="text-xs text-zinc-500">Fit Ratio</p>
                <p
                  className={cn(
                    "mt-2 text-xl font-semibold",
                    walletPoolFitData.fitRatio >= 0.6
                      ? "text-emerald-400"
                      : "text-amber-300",
                  )}
                >
                  {formatPercent(walletPoolFitData.fitRatio)}
                </p>
              </article>
              <article className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
                <p className="text-xs text-zinc-500">Signal</p>
                <p
                  className={cn(
                    "mt-2 text-xl font-semibold",
                    fitIsGood ? "text-emerald-400" : "text-rose-400",
                  )}
                >
                  {fitIsGood ? "✓ Fit tốt" : "✕ Fit thấp"}
                </p>
              </article>
            </section>

            <section className="overflow-x-auto rounded-xl border border-zinc-800 bg-paper-2">
              <table className="min-w-[840px] divide-y divide-zinc-800 text-sm">
                <thead className="bg-paper-3 text-xs text-muted uppercase">
                  <tr>
                    <th className="px-3 py-3 text-left">Wallet Pair</th>
                    <th className="px-3 py-3 text-right">Trades</th>
                    <th className="px-3 py-3 text-right">Matched Pools</th>
                    <th className="px-3 py-3 text-left">Best Pool</th>
                    <th className="px-3 py-3 text-right">Best Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {walletPoolFitData.rows.map((row) => (
                    <tr key={row.pair}>
                      <td className="px-3 py-3 font-medium text-zinc-100">
                        {row.pair}
                      </td>
                      <td className="px-3 py-3 text-right text-zinc-300">
                        {formatNumber(row.count, 0)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right",
                          row.matchCount > 0
                            ? "text-emerald-400"
                            : "text-rose-400",
                        )}
                      >
                        {formatNumber(row.matchCount, 0)}
                      </td>
                      <td className="px-3 py-3 text-zinc-200">
                        {row.bestPool
                          ? getPoolPairLabel(row.bestPool)
                          : "No match"}
                      </td>
                      <td className="px-3 py-3 text-right text-zinc-300">
                        {row.bestScore.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {walletPoolFitData.rows.length === 0 && (
                    <tr>
                      <td
                        className="px-3 py-8 text-center text-zinc-500"
                        colSpan={5}
                      >
                        Ví chưa có top pair để so khớp.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        );
      }

      default:
        return buildStateCard("Analysis", "Option chưa được hỗ trợ.");
    }
  })();

  return (
    <main className="mx-auto flex w-full max-w-[var(--page-max)] flex-1 flex-col gap-5 px-[var(--page-gutter)] py-8">
      <section className="rounded-xl border border-zinc-800 bg-paper-2 p-5">
        <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
          Wallet Analysis
        </p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-ink sm:text-[32px]">
          Phân tích lịch sử Add LP theo address
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Chọn 1 option ở sidebar để chỉ chạy đúng phân tích đó, tránh chạy toàn
          bộ một lượt.
        </p>

        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
          onSubmit={handleAnalyze}
        >
          <div className="flex-1">
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Nhập Solana wallet address..."
              className={inputClassName}
            />
            {isInvalidAddress && (
              <p className="mt-1 text-xs text-rose-400">
                Address chưa đúng format Solana (32-44 ký tự base58).
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={
              isWalletScoreLoading ||
              isCoreLoading ||
              isTimeDistributionLoading ||
              isMeteoraPoolsLoading
            }
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink transition hover:bg-focus disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isWalletScoreLoading ||
            isCoreLoading ||
            isTimeDistributionLoading ||
            isMeteoraPoolsLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Analyze
              </>
            )}
          </button>
        </form>

        {errorMessage && (
          <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {errorMessage}
          </p>
        )}

        {result &&
          Array.isArray(result.warnings) &&
          result.warnings.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              {result.warnings.map((warning, index) => (
                <p key={`${warning.source}-${index}`}>
                  [{warning.source}]
                  {warning.status ? ` (${warning.status})` : ""}:{" "}
                  {warning.message}
                </p>
              ))}
            </div>
          )}

        {analyzedOwner && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span className="rounded-md border border-zinc-700 bg-paper px-2 py-1">
              Owner: {shorten(ownerBadgeValue, 8, 8)}
            </span>
            <button
              type="button"
              onClick={() => handleCopy(ownerBadgeValue)}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-paper px-2 py-1 text-zinc-300 hover:bg-zinc-800"
            >
              <Copy className="h-3 w-3" />
              Copy
            </button>
            <span className="rounded-md border border-zinc-700 bg-paper px-2 py-1">
              Option: {activeOptionMeta?.label || activeOption}
            </span>
            {(result?.generatedAt ||
              walletScore?.generatedAt ||
              timeDistribution?.generatedAt) && (
              <span className="rounded-md border border-zinc-700 bg-paper px-2 py-1">
                Updated:{" "}
                {formatDateTime(
                  result?.generatedAt ||
                    walletScore?.generatedAt ||
                    timeDistribution?.generatedAt ||
                    null,
                )}
              </span>
            )}
          </div>
        )}
      </section>

      {analyzedOwner && <WalletTradesPanel owner={analyzedOwner} />}

      {analyzedOwner ? (
        <section className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="h-fit rounded-xl border border-zinc-800 bg-paper-2 p-3 lg:sticky lg:top-20">
            <p className="px-2 py-1 text-xs font-medium tracking-wide text-zinc-400 uppercase">
              Analysis Options
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {ANALYSIS_OPTIONS.map((option) => {
                const active = activeOption === option.key;
                const ready = optionReady(option.key);

                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => handleSelectOption(option.key)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left transition",
                      active
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : "border-zinc-800 bg-paper-3 hover:border-zinc-700",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          active ? "text-emerald-300" : "text-zinc-100",
                        )}
                      >
                        {option.label}
                      </p>
                      <span
                        className={cn(
                          "inline-flex h-2.5 w-2.5 rounded-full",
                          ready ? "bg-emerald-400" : "bg-zinc-600",
                        )}
                      />
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            <section className="rounded-xl border border-zinc-800 bg-paper-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-zinc-500 uppercase">
                    WalletScore v1
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-zinc-100">
                    Score & Confidence
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {walletScore && (
                    <>
                      <span
                        className={cn(
                          "rounded-md border px-2 py-1 text-xs font-medium",
                          tierBadgeClass(walletScore.tier),
                        )}
                      >
                        {walletScore.tier}
                      </span>
                      <span
                        className={cn(
                          "rounded-md border px-2 py-1 text-xs font-medium",
                          confidenceBadgeClass(walletScore.confidence.level),
                        )}
                      >
                        {walletScore.confidence.level}
                      </span>
                    </>
                  )}
                  {isWalletScoreLoading && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-300">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Scoring...
                    </span>
                  )}
                </div>
              </div>

              {walletScoreError && (
                <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                  {walletScoreError}
                </p>
              )}

              {!walletScore && !isWalletScoreLoading && !walletScoreError && (
                <p className="mt-3 text-sm text-zinc-400">
                  Nhấn Analyze để tính WalletScore cho ví này.
                </p>
              )}

              {walletScore && (
                <>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <article className="rounded-xl border border-zinc-800 bg-paper-3 p-3">
                      <p className="text-xs text-zinc-500">Total Score</p>
                      <p
                        className={cn(
                          "mt-1 text-2xl font-semibold",
                          scoreTextClass(walletScore.totalScore),
                        )}
                      >
                        {walletScore.totalScore.toFixed(2)}
                      </p>
                    </article>
                    <article className="rounded-xl border border-zinc-800 bg-paper-3 p-3">
                      <p className="text-xs text-zinc-500">Profit Score</p>
                      <p className="mt-1 text-base font-semibold text-zinc-100">
                        {walletScore.breakdown.profit.toFixed(2)} / 30
                      </p>
                    </article>
                    <article className="rounded-xl border border-zinc-800 bg-paper-3 p-3">
                      <p className="text-xs text-zinc-500">Stability Score</p>
                      <p className="mt-1 text-base font-semibold text-zinc-100">
                        {walletScore.breakdown.stability.toFixed(2)} / 25
                      </p>
                    </article>
                    <article className="rounded-xl border border-zinc-800 bg-paper-3 p-3">
                      <p className="text-xs text-zinc-500">Risk + Pool Score</p>
                      <p className="mt-1 text-base font-semibold text-zinc-100">
                        {(
                          walletScore.breakdown.risk +
                          walletScore.breakdown.poolSelection
                        ).toFixed(2)}{" "}
                        / 45
                      </p>
                    </article>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <article className="rounded-xl border border-zinc-800 bg-paper-3 p-3">
                      <p className="text-xs text-zinc-500">Confidence</p>
                      <p className="mt-1 text-sm text-zinc-200">
                        Value: {formatPercent(walletScore.confidence.value)}
                      </p>
                      <div className="mt-2 space-y-1 text-xs text-zinc-300">
                        {walletScore.confidence.reasons
                          .slice(0, 3)
                          .map((reason, index) => (
                            <p key={`score-confidence-${index}`}>{reason}</p>
                          ))}
                      </div>
                    </article>

                    <article className="rounded-xl border border-zinc-800 bg-paper-3 p-3">
                      <p className="text-xs text-zinc-500">Score Reasons</p>
                      <div className="mt-2 space-y-1 text-xs text-zinc-300">
                        {walletScore.reasons
                          .slice(0, 4)
                          .map((reason, index) => (
                            <p key={`score-reason-${index}`}>{reason}</p>
                          ))}
                      </div>
                    </article>
                  </div>

                  {Array.isArray(walletScore.warnings) &&
                    walletScore.warnings.length > 0 && (
                      <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                        {walletScore.warnings.map((warning, index) => (
                          <p key={`wallet-score-warning-${index}`}>
                            [{warning.source}]
                            {warning.status ? ` (${warning.status})` : ""}:{" "}
                            {warning.message}
                          </p>
                        ))}
                      </div>
                    )}
                </>
              )}
            </section>

            {optionContent}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-zinc-800 bg-paper-2 p-5">
          <p className="text-sm text-zinc-300">
            Nhập ví Solana và nhấn Analyze. Sau đó chọn option ở sidebar để chạy
            phân tích theo nhu cầu.
          </p>
        </section>
      )}
    </main>
  );
}
