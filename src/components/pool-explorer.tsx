"use client";

import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Star,
  TriangleAlert,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { cn } from "@/lib/utils";

/* ── Types (subset of the Meteora pool discovery payload) ────────── */

export interface ExplorerToken {
  address?: string;
  symbol?: string;
  icon?: string;
  is_verified?: boolean;
  has_mint_authority?: boolean;
  has_freeze_authority?: boolean;
  organic_score_label?: string;
  top_holders_pct?: number;
  market_cap?: number;
  holders?: number;
  created_at?: number;
  tags?: string[];
  warnings?: Array<{ type?: string; message?: string; severity?: string }>;
}

export interface ExplorerPool {
  pool_address?: string;
  name?: string;
  pool_type?: string;
  token_x?: ExplorerToken;
  token_y?: ExplorerToken;
  tvl?: number;
  tvl_change_pct?: number;
  active_tvl?: number;
  active_tvl_change_pct?: number;
  volume?: number;
  volume_change_pct?: number;
  fee?: number;
  fee_change_pct?: number;
  fee_pct?: number;
  fee_active_tvl_ratio?: number;
  fee_active_tvl_ratio_change_pct?: number;
  pool_price?: number;
  pool_price_change_pct?: number;
  base_token_market_cap_change_pct?: number;
  pool_created_at?: number;
  is_blacklisted?: boolean;
  dlmm_params?: { bin_step?: number } | null;
  permanent_lock_liquidity_pct?: number;
  unique_lps?: number;
  open_positions?: number;
  price_trend?: Array<number | string>;
}

export interface ExplorerPage {
  data: ExplorerPool[];
  total: number;
  afterKey: string | null;
  hasMore: boolean;
  fetchedAt: string | null;
  source: "live" | "snapshot";
}

const TIMEFRAMES = ["5m", "30m", "1h", "2h", "4h", "12h", "24h"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

type Category = "all" | "favorites" | "top" | "trending" | "new" | "rwa";
const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: "all", label: "All" },
  { key: "favorites", label: "Favorites" },
  { key: "top", label: "Top Performers" },
  { key: "trending", label: "Trending" },
  { key: "new", label: "New Tokens" },
  { key: "rwa", label: "RWA" },
];

type Protocol = "all" | "dlmm" | "damm_v2";

type SortKey =
  | "token_age"
  | "market_cap"
  | "pool_price"
  | "tvl"
  | "active_tvl"
  | "fee"
  | "fee_active_tvl_ratio";

/* ── Formatting ──────────────────────────────────────────────────── */

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatUsd(value: number) {
  if (value < 1_000) {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
  }
  return usdCompact.format(value);
}

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "–";
  if (value >= 1_000)
    return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (value >= 1)
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  const decimals = Math.min(
    10,
    Math.max(4, -Math.floor(Math.log10(value)) + 1),
  );
  return value.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
}

function tokenAgeMs(pool: ExplorerPool) {
  const created =
    toNumber(pool.token_x?.created_at) || toNumber(pool.pool_created_at);
  return created > 0 ? Date.now() - created : null;
}

function formatAge(ms: number | null) {
  if (ms === null || ms < 0) return "–";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ${hours % 24}h`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ${days % 30}d`;
  return `${Math.floor(months / 12)}y ${months % 12}mo`;
}

function sortValue(pool: ExplorerPool, key: SortKey): number {
  switch (key) {
    case "token_age":
      return tokenAgeMs(pool) ?? 0;
    case "market_cap":
      return toNumber(pool.token_x?.market_cap);
    case "pool_price":
      return toNumber(pool.pool_price);
    default:
      return toNumber(pool[key]);
  }
}

/* ── Favorites (localStorage, shared across tabs) ────────────────── */

const FAV_KEY = "pool-favorites";
const favListeners = new Set<() => void>();
let favCache: { raw: string | null; value: string[] } = {
  raw: null,
  value: [],
};

function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (raw === favCache.raw) return favCache.value;
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const value = Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
    favCache = { raw, value };
    return value;
  } catch {
    return favCache.value;
  }
}
function subscribeFavorites(listener: () => void) {
  favListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    favListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
function toggleFavorite(address: string) {
  const current = readFavorites();
  const next = current.includes(address)
    ? current.filter((item) => item !== address)
    : [...current, address];
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable
  }
  for (const listener of favListeners) listener();
}
const EMPTY: string[] = [];

/* ── Small pieces ────────────────────────────────────────────────── */

function Change({ value, className }: { value: number; className?: string }) {
  if (!Number.isFinite(value) || value === 0) {
    return <span className={cn("text-muted", className)}>0%</span>;
  }
  const text = `${value > 0 ? "+" : ""}${Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2)}%`;
  return (
    <span
      className={cn(value > 0 ? "text-[#4ade80]" : "text-[#f87171]", className)}
    >
      {text}
    </span>
  );
}

function Sparkline({
  points,
  id,
}: {
  points?: Array<number | string>;
  id: string;
}) {
  const values = (points ?? [])
    .map((value) => toNumber(value, -1))
    .filter((value) => value > 0);
  if (values.length < 2) return <span className="text-muted text-xs">–</span>;

  const width = 140;
  const height = 56;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || max || 1;
  const step = width / (values.length - 1);
  const coords = values.map((value, index) => {
    const x = index * step;
    const y = height - 4 - ((value - min) / span) * (height - 10);
    return [x, y] as const;
  });
  // Smooth with a Catmull-Rom → Bézier conversion, like Meteora's trend line.
  let d = `M${coords[0][0]},${coords[0][1]}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const up = values[values.length - 1] >= values[0];
  const color = up ? "#4ade80" : "#f87171";
  const gradientId = `spark-${id}`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="block"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${d} L${width},${height} L0,${height} Z`}
        fill={`url(#${gradientId})`}
      />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TokenIcon({
  token,
  size = "h-9 w-9",
}: {
  token?: ExplorerToken;
  size?: string;
}) {
  const [broken, setBroken] = useState(false);
  const symbol = token?.symbol?.trim() || "?";
  if (token?.icon && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={token.icon}
        alt={symbol}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={cn(
          "border-paper bg-paper-3 rounded-full border-2 object-cover",
          size,
        )}
      />
    );
  }
  return (
    <span
      className={cn(
        "border-paper bg-paper-4 text-ink-2 inline-flex items-center justify-center rounded-full border-2 text-xs font-semibold",
        size,
      )}
    >
      {symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ProtocolPill({ type }: { type?: string }) {
  const damm = type === "damm_v2";
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md px-2 text-[11px] font-medium",
        damm
          ? "bg-[#7c3aed]/15 text-[#c4b5fd]"
          : "bg-[#f97316]/15 text-[#fdba74]",
      )}
    >
      {damm ? "DAMM V2" : "DLMM"}
    </span>
  );
}

function TokenTags({ token }: { token?: ExplorerToken }) {
  const tags = (token?.tags ?? [])
    .filter((tag) => tag && tag !== "unknown")
    .slice(0, 3);
  const verified = token?.is_verified === true;
  if (!verified && tags.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {verified && (
        <span className="inline-flex h-5 items-center rounded-full bg-[#22c55e]/15 px-1.5 text-[10px] font-medium text-[#4ade80]">
          verified
        </span>
      )}
      {tags.map((tag) => (
        <span
          key={tag}
          className="bg-paper-3 text-muted inline-flex h-5 items-center rounded-full px-1.5 text-[10px]"
        >
          {tag}
        </span>
      ))}
    </span>
  );
}

function Th({
  label,
  sortKey,
  active,
  direction,
  onSort,
  align = "right",
  className,
}: {
  label: string;
  sortKey?: SortKey;
  active: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const sortable = Boolean(sortKey);
  const isActive = sortable && active === sortKey;
  const Icon = !isActive
    ? ChevronsUpDown
    : direction === "asc"
      ? ChevronUp
      : ChevronDown;
  return (
    <th
      className={cn(
        "text-muted px-4 py-3 text-sm font-normal whitespace-nowrap",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort(sortKey as SortKey)}
          className={cn(
            "hover:text-ink inline-flex items-center gap-1 underline decoration-dotted underline-offset-4 transition-colors",
            isActive && "text-ink",
            align === "right" && "flex-row-reverse",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

function Metric({
  value,
  change,
  align = "right",
}: {
  value: string;
  change: number;
  align?: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        align === "right" ? "items-end" : "items-start",
      )}
    >
      <span className="data text-ink text-[15px]">{value}</span>
      <Change value={change} className="data text-xs" />
    </div>
  );
}

const selectClass =
  "border-rule bg-paper-2 text-ink hover:border-rule-2 focus-visible:border-rule-2 h-10 appearance-none rounded-lg border py-0 pr-9 pl-3 text-sm font-medium outline-none transition-colors";

/* ── Component ───────────────────────────────────────────────────── */

export function PoolExplorer({ initial }: { initial: ExplorerPage }) {
  const router = useRouter();
  const [page, setPage] = useState<ExplorerPage>(initial);
  const [timeframe, setTimeframe] = useState<Timeframe>("2h");
  const [category, setCategory] = useState<Category>("top");
  const [protocol, setProtocol] = useState<Protocol>("all");
  const [query, setQuery] = useState("");
  const [serverQuery, setServerQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [qualityOnly, setQualityOnly] = useState(true);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [quote, setQuote] = useState("all");
  const [minTvl, setMinTvl] = useState("");
  const [minFees, setMinFees] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("fee_active_tvl_ratio");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const requestId = useRef(0);

  const favorites = useSyncExternalStore(
    subscribeFavorites,
    readFavorites,
    () => EMPTY,
  );
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const fetchPage = useCallback(
    async (
      options: { afterKey?: string | null; q?: string } = {},
      append = false,
    ) => {
      const id = ++requestId.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setFetchError("");
      try {
        let data: ExplorerPool[] = [];
        let total = 0;
        let afterKey: string | null = null;
        let hasMore = false;
        let fetchedAt: string | null = null;

        if (category === "favorites") {
          const addresses = readFavorites().slice(0, 25);
          const pages = await Promise.all(
            addresses.map(async (address) => {
              const params = new URLSearchParams({
                timeframe,
                category: "all",
                quality: "0",
                q: address,
                page_size: "1",
              });
              const response = await fetch(`/api/meteora/pools?${params}`);
              const body = (await response.json()) as { data?: ExplorerPool[] };
              return response.ok ? (body.data ?? []) : [];
            }),
          );
          data = pages
            .flat()
            .filter(
              (pool) =>
                pool.pool_address && addresses.includes(pool.pool_address),
            );
          total = data.length;
          fetchedAt = new Date().toISOString();
        } else {
          const params = new URLSearchParams({ timeframe, category });
          if (!qualityOnly) params.set("quality", "0");
          if (options.afterKey) params.set("after_key", options.afterKey);
          if (options.q) params.set("q", options.q);
          const response = await fetch(`/api/meteora/pools?${params}`);
          const body = (await response.json()) as {
            data?: ExplorerPool[];
            total?: number;
            afterKey?: string | null;
            hasMore?: boolean;
            fetchedAt?: string;
            message?: string;
          };
          if (!response.ok)
            throw new Error(body.message || `HTTP ${response.status}`);
          data = body.data ?? [];
          total = body.total ?? 0;
          afterKey = body.afterKey ?? null;
          hasMore = body.hasMore === true;
          fetchedAt = body.fetchedAt ?? null;
        }

        if (id !== requestId.current) return;
        setPage((previous) => ({
          data: append ? [...previous.data, ...data] : data,
          total,
          afterKey,
          hasMore,
          fetchedAt,
          source: "live",
        }));
      } catch (error) {
        if (id !== requestId.current) return;
        setFetchError(
          error instanceof Error ? error.message : "Failed to load pools",
        );
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [timeframe, category, qualityOnly],
  );

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (initial.source === "live") return;
    }
    void fetchPage({ q: serverQuery || undefined });
  }, [fetchPage, serverQuery, initial.source]);

  useEffect(() => {
    const term = query.trim();
    const handle = window.setTimeout(() => {
      setServerQuery(term.length >= 2 ? term : "");
    }, 350);
    return () => window.clearTimeout(handle);
  }, [query]);

  const pools = page.data;

  const quotes = useMemo(() => {
    const set = new Set<string>();
    for (const pool of pools) {
      const symbol = pool.token_y?.symbol?.trim();
      if (symbol) set.add(symbol);
    }
    return Array.from(set).sort();
  }, [pools]);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const tvlFloor = toNumber(minTvl);
    const feeFloor = toNumber(minFees);
    const filtered = pools.filter((pool) => {
      if (protocol !== "all" && (pool.pool_type || "dlmm") !== protocol)
        return false;
      if (quote !== "all" && pool.token_y?.symbol !== quote) return false;
      if (verifiedOnly && pool.token_x?.is_verified !== true) return false;
      if (tvlFloor > 0 && toNumber(pool.tvl) < tvlFloor) return false;
      if (feeFloor > 0 && toNumber(pool.fee) < feeFloor) return false;
      if (term && term.length < 2) {
        const haystack = [pool.name, pool.token_x?.symbol, pool.token_y?.symbol]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
    const direction = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort(
      (a, b) => direction * (sortValue(a, sortKey) - sortValue(b, sortKey)),
    );
  }, [
    pools,
    query,
    protocol,
    quote,
    verifiedOnly,
    minTvl,
    minFees,
    sortKey,
    sortDir,
  ]);

  function onSort(key: SortKey) {
    if (key === sortKey) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const activeFilterCount =
    (qualityOnly ? 1 : 0) +
    (verifiedOnly ? 1 : 0) +
    (quote !== "all" ? 1 : 0) +
    (minTvl ? 1 : 0) +
    (minFees ? 1 : 0);

  return (
    <main className="mx-auto flex w-full max-w-[var(--page-max)] flex-1 flex-col gap-4 px-[var(--page-gutter)] py-6">
      {/* Top bar: categories · search · timeframe · filters */}
      <section className="flex flex-wrap items-center gap-3">
        <nav
          aria-label="Pool categories"
          className="flex items-center gap-1 overflow-x-auto"
        >
          {CATEGORIES.map((item) => {
            const active = category === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setCategory(item.key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "h-10 rounded-lg px-3 text-[17px] font-medium whitespace-nowrap transition-colors",
                  active ? "text-[#fb923c]" : "text-muted hover:text-ink",
                )}
              >
                {item.label}
                {item.key === "favorites" && favorites.length > 0 && (
                  <span className="text-muted ml-1.5 text-xs">
                    {favorites.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="border-rule bg-paper-2 focus-within:border-rule-2 flex h-10 w-full items-center gap-2 rounded-lg border px-3 transition-colors sm:w-72">
            <Search className="text-muted h-4 w-4 shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter Token"
              className="text-ink placeholder:text-muted h-full w-full bg-transparent text-sm outline-none"
            />
            {loading && (
              <LoaderCircle className="text-muted h-4 w-4 animate-spin" />
            )}
          </label>
          <span className="relative">
            <select
              value={timeframe}
              onChange={(event) =>
                setTimeframe(event.target.value as Timeframe)
              }
              aria-label="Timeframe"
              className={selectClass}
            >
              {TIMEFRAMES.map((value) => (
                <option key={value} value={value}>
                  {value.toUpperCase()}
                </option>
              ))}
            </select>
            <ChevronDown className="text-muted pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2" />
          </span>
          <button
            type="button"
            onClick={() => setShowFilters((value) => !value)}
            aria-expanded={showFilters}
            aria-label="Filters"
            className={cn(
              "border-rule bg-paper-2 text-ink-2 hover:text-ink relative inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-colors",
              showFilters && "border-rule-2 text-ink",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f97316] px-1 text-[11px] font-semibold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </section>

      {showFilters && (
        <section className="border-rule bg-paper-2 flex flex-wrap items-end gap-4 rounded-xl border px-4 py-3">
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={qualityOnly}
              onChange={(event) => setQualityOnly(event.target.checked)}
              className="accent-accent h-4 w-4"
            />
            Meteora quality filter
            <span className="text-muted text-xs">
              mcap ≥ $70k · holders ≥ 15 · volume ≥ $1k · fees ≥ $5 · active TVL
              ≥ $10k
            </span>
          </label>
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={(event) => setVerifiedOnly(event.target.checked)}
              className="accent-accent h-4 w-4"
            />
            Verified base token
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">Quote token</span>
            <span className="relative">
              <select
                value={quote}
                onChange={(event) => setQuote(event.target.value)}
                className={cn(selectClass, "h-9")}
              >
                <option value="all">All</option>
                {quotes.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </select>
              <ChevronDown className="text-muted pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2" />
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">Min TVL (USD)</span>
            <input
              value={minTvl}
              onChange={(event) => setMinTvl(event.target.value)}
              inputMode="numeric"
              placeholder="0"
              className="border-rule bg-paper text-ink h-9 w-32 rounded-lg border px-3 font-mono text-sm outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">Min fees {timeframe} (USD)</span>
            <input
              value={minFees}
              onChange={(event) => setMinFees(event.target.value)}
              inputMode="numeric"
              placeholder="0"
              className="border-rule bg-paper text-ink h-9 w-32 rounded-lg border px-3 font-mono text-sm outline-none"
            />
          </label>
        </section>
      )}

      {/* Table */}
      <section className="border-rule bg-paper-2 rounded-xl border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-sm">
            <thead className="bg-paper-3/40">
              <tr>
                <th className="px-4 py-2.5 text-left" colSpan={2}>
                  <div
                    role="tablist"
                    className="bg-paper border-rule inline-flex h-9 items-center gap-0.5 rounded-lg border p-0.5"
                  >
                    {(
                      [
                        { key: "all", label: "All" },
                        { key: "dlmm", label: "DLMM" },
                        { key: "damm_v2", label: "DAMM V2" },
                      ] as Array<{ key: Protocol; label: string }>
                    ).map((item) => {
                      const active = protocol === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setProtocol(item.key)}
                          className={cn(
                            "h-7 rounded-md px-3 text-sm transition-colors",
                            active
                              ? "bg-paper-4 text-ink font-medium"
                              : "text-muted hover:text-ink",
                          )}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </th>
                <Th
                  label="Price Trend"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  align="left"
                />
                <Th
                  label="Token Age"
                  sortKey="token_age"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Market Cap"
                  sortKey="market_cap"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Pool Price"
                  sortKey="pool_price"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="TVL"
                  sortKey="tvl"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Active TVL"
                  sortKey="active_tvl"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Fees"
                  sortKey="fee"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Fees/Active TVL"
                  sortKey="fee_active_tvl_ratio"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="LPs"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  className="w-20"
                />
              </tr>
            </thead>
            <tbody className="divide-rule divide-y">
              {rows.map((pool, index) => {
                const address = pool.pool_address ?? "";
                const href = address
                  ? `/pool/${address}?protocol=${pool.pool_type || "dlmm"}`
                  : null;
                const warnings = pool.token_x?.warnings?.length ?? 0;
                const isFav = favoriteSet.has(address);
                const damm = pool.pool_type === "damm_v2";
                const binStep = pool.dlmm_params?.bin_step;
                const lock = toNumber(pool.permanent_lock_liquidity_pct);
                const quoteSymbol = pool.token_y?.symbol ?? "";
                return (
                  <tr
                    key={`${address || pool.name || "pool"}-${index}`}
                    onClick={href ? () => router.push(href) : undefined}
                    className={cn(
                      "group transition-colors",
                      href && "hover:bg-paper-3/40 cursor-pointer",
                    )}
                  >
                    <td className="w-14 px-4 py-4 align-top">
                      <div className="flex flex-col items-center gap-2">
                        <span className="data text-muted text-sm">
                          #{index + 1}
                        </span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (address) toggleFavorite(address);
                          }}
                          aria-pressed={isFav}
                          aria-label={
                            isFav ? "Remove from favorites" : "Add to favorites"
                          }
                          className={cn(
                            "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                            isFav
                              ? "text-[#fbbf24]"
                              : "text-muted hover:text-ink",
                          )}
                        >
                          <Star
                            className="h-4 w-4"
                            fill={isFav ? "currentColor" : "none"}
                          />
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-4 align-top">
                      <div className="flex items-start gap-3">
                        <span className="flex shrink-0 -space-x-2.5">
                          <TokenIcon token={pool.token_x} />
                          <TokenIcon token={pool.token_y} />
                        </span>
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <span className="flex items-center gap-1.5">
                            <span className="text-ink group-hover:text-accent truncate text-[15px] font-semibold transition-colors">
                              {pool.name || "-"}
                            </span>
                            {warnings > 0 && (
                              <span
                                title={pool.token_x?.warnings
                                  ?.map((w) => w.message)
                                  .filter(Boolean)
                                  .join("\n")}
                                className="inline-flex items-center gap-0.5 text-[#fbbf24]"
                              >
                                <TriangleAlert
                                  className="h-3.5 w-3.5"
                                  fill="currentColor"
                                  stroke="#0a0a0b"
                                />
                                <span className="text-xs font-medium">
                                  {warnings}
                                </span>
                              </span>
                            )}
                          </span>
                          <span className="text-muted text-xs">
                            Fee:{" "}
                            <span className="text-ink-2">
                              {toNumber(pool.fee_pct).toLocaleString("en-US", {
                                maximumFractionDigits: 2,
                              })}
                              %
                            </span>
                            {damm ? (
                              <>
                                {" "}
                                • Lock:{" "}
                                <span className="text-ink-2">
                                  {lock.toFixed(0)}%
                                </span>
                              </>
                            ) : binStep ? (
                              <>
                                {" "}
                                • Bin Step:{" "}
                                <span className="text-ink-2">{binStep}</span>
                              </>
                            ) : null}
                          </span>
                          <span className="flex flex-wrap items-center gap-2">
                            <ProtocolPill type={pool.pool_type} />
                            <TokenTags token={pool.token_x} />
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <Sparkline
                        points={pool.price_trend}
                        id={`${index}-${address.slice(0, 6)}`}
                      />
                    </td>
                    <td className="data text-ink px-4 py-4 text-right align-middle text-[15px] whitespace-nowrap">
                      {formatAge(tokenAgeMs(pool))}
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <Metric
                        value={formatUsd(toNumber(pool.token_x?.market_cap))}
                        change={toNumber(pool.base_token_market_cap_change_pct)}
                      />
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <Metric
                        value={`${formatPrice(toNumber(pool.pool_price))} ${quoteSymbol}`}
                        change={toNumber(pool.pool_price_change_pct)}
                      />
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <Metric
                        value={formatUsd(toNumber(pool.tvl))}
                        change={toNumber(pool.tvl_change_pct)}
                      />
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <Metric
                        value={formatUsd(toNumber(pool.active_tvl))}
                        change={toNumber(pool.active_tvl_change_pct)}
                      />
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <Metric
                        value={formatUsd(toNumber(pool.fee))}
                        change={toNumber(pool.fee_change_pct)}
                      />
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <Metric
                        value={`${toNumber(pool.fee_active_tvl_ratio).toFixed(2)}%`}
                        change={toNumber(pool.fee_active_tvl_ratio_change_pct)}
                      />
                    </td>
                    <td className="px-4 py-4 text-right align-middle">
                      {href && (
                        <Link
                          href={href}
                          onClick={(event) => event.stopPropagation()}
                          aria-label="Open pool: who is providing liquidity"
                          title="See LP wallets and their PnL"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#7c3aed]/40 bg-[#7c3aed]/15 text-[#c4b5fd] transition-colors hover:bg-[#7c3aed]/30"
                        >
                          <Zap className="h-4 w-4" fill="currentColor" />
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    className="text-muted px-4 py-14 text-center"
                  >
                    {fetchError
                      ? `Could not reach Meteora: ${fetchError}`
                      : loading
                        ? "Loading pools…"
                        : category === "favorites" && favorites.length === 0
                          ? "Star a pool to keep it here."
                          : pools.length === 0
                            ? "No pools in this view."
                            : "No pools match these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-muted border-rule flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs">
          <span>
            {rows.length} shown · {pools.length} loaded
            {category !== "favorites"
              ? ` of ${page.total.toLocaleString()}`
              : ""}{" "}
            ·{" "}
            {page.source === "live" ? "live Meteora data" : "offline snapshot"}
            {page.fetchedAt
              ? ` · updated ${new Date(page.fetchedAt).toLocaleTimeString()}`
              : ""}
          </span>
          {page.hasMore && page.afterKey && (
            <button
              type="button"
              onClick={() =>
                void fetchPage(
                  { afterKey: page.afterKey, q: serverQuery || undefined },
                  true,
                )
              }
              disabled={loadingMore}
              className="text-accent hover:text-focus inline-flex items-center gap-1.5 font-medium transition-colors disabled:opacity-50"
            >
              {loadingMore && (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              )}
              Load 50 more
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
