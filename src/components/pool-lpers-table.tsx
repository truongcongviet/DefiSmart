"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  ClipboardCopy,
  Copy,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuthFlow } from "@/components/auth/auth-flow-provider";
import { cn } from "@/lib/utils";

/* ── Types mirrored from /api/pools/[address]/lpers ──────────────── */

interface TokenInfo {
  symbol: string;
  address: string;
  logo: string;
}

interface PoolMeta {
  address: string;
  protocol: "meteora_dlmm" | "meteora_damm_v2";
  name: string;
  tokenX: TokenInfo;
  tokenY: TokenInfo;
  tvl: number;
  volume24h: number;
  fees24h: number;
  feeTvl24h: number;
  baseFeePct: number | null;
  binStep: number | null;
  currentPrice: number | null;
  createdAtMs: number | null;
}

interface PositionRow {
  owner: string;
  position: string;
  valueUsd: number;
  valueNative: number;
  shareOfPool: number;
  feeUsd: number;
  feeNative: number;
  unclaimedFeeNative: number;
  pnlUsd: number;
  pnlNative: number;
  pnlPercent: number;
  pnlPercentNative: number;
  ageHours: number;
  minPrice: number | null;
  maxPrice: number | null;
  inRange: boolean | null;
  createdAt: string | null;
}

interface WalletRow {
  owner: string;
  avgAgeHours: number;
  positions: number;
  openPositions: number;
  closedPositions: number;
  depositUsd: number;
  depositNative: number;
  feeUsd: number;
  feeNative: number;
  pnlUsd: number;
  pnlNative: number;
  pnlPercent: number;
  winRate: number;
  inRange: boolean | null;
  lastActivity: string | null;
}

interface PoolLpersResponse {
  pool: PoolMeta;
  generatedAt: string;
  solPrice: number | null;
  totals: {
    openPositionsOnChain: number;
    walletsOnChain: number;
    walletsAnalyzed: number;
    depositUsd: number;
    pnlUsd: number;
    feeUsd: number;
    winners: number;
    losers: number;
  };
  wallets: WalletRow[];
  positions: PositionRow[];
  warnings: string[];
  rpc: "public" | "custom";
  message?: string;
}

type Tab = "positions" | "top" | "mine";
type PositionSort = "valueNative" | "feeNative" | "pnlNative" | "ageHours";
type WalletSort =
  | "pnlNative"
  | "feeNative"
  | "positions"
  | "avgAgeHours"
  | "winRate";
type Direction = "asc" | "desc";

const PAGE = 20;

/* ── Formatting ──────────────────────────────────────────────────── */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

function formatSol(value: number, digits = 4) {
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.01) return value < 0 ? "> -0.01" : "< 0.01";
  if (abs >= 1_000) {
    return `${(value / 1_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}k`;
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(digits, 2),
    maximumFractionDigits: digits,
  });
}

function formatPct(value: number) {
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.01) return value < 0 ? "> -0.01%" : "< 0.01%";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function formatPrice(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) return "–";
  if (value >= 1_000)
    return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (value >= 1)
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  const decimals = Math.min(
    10,
    Math.max(4, -Math.floor(Math.log10(value)) + 2),
  );
  return value.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
}

function humanAge(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return "–";
  const minutes = hours * 60;
  if (minutes < 1.5) return "a minute";
  if (minutes < 60) return `${Math.round(minutes)} minutes`;
  if (hours < 1.5) return "an hour";
  if (hours < 24) return `${Math.round(hours)} hours`;
  const days = hours / 24;
  if (days < 1.5) return "a day";
  if (days < 30) return `${Math.round(days)} days`;
  const months = days / 30;
  if (months < 1.5) return "a month";
  if (months < 12) return `${Math.round(months)} months`;
  const years = months / 12;
  return years < 1.5 ? "a year" : `${Math.round(years)} years`;
}

function shortAddress(value: string, size = 6) {
  return value.length <= size * 2 + 3
    ? value
    : `${value.slice(0, size)}...${value.slice(-4)}`;
}

function tone(value: number) {
  if (value > 0) return "text-[#4ade80]";
  if (value < 0) return "text-[#fb7185]";
  return "text-ink-2";
}

/* ── Small pieces ────────────────────────────────────────────────── */

function SolMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logos/tokens/sol.png"
      alt="SOL"
      width={14}
      height={14}
      className="ml-1 inline-block h-3.5 w-3.5 rounded-full align-[-2px]"
    />
  );
}

function TokenLogo({ token }: { token: TokenInfo }) {
  const [broken, setBroken] = useState(false);
  if (token.logo && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={token.logo}
        alt={token.symbol}
        onError={() => setBroken(true)}
        referrerPolicy="no-referrer"
        className="border-paper bg-paper-3 h-8 w-8 rounded-full border-2 object-cover"
      />
    );
  }
  return (
    <span className="border-paper bg-paper-4 text-ink-2 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold">
      {token.symbol.slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

function CopyIcon({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_200);
    } catch {
      // clipboard unavailable
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className="text-muted hover:text-ink inline-flex h-5 w-5 items-center justify-center rounded transition-colors"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-[#4ade80]" />
      ) : (
        <ClipboardCopy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function OwnerLink({ owner }: { owner: string }) {
  return (
    <Link
      href={`/analysis?owner=${owner}`}
      className="data text-accent hover:text-focus underline decoration-dotted underline-offset-4"
      title={owner}
    >
      {shortAddress(owner)}
    </Link>
  );
}

function Th<K extends string>({
  label,
  sortKey,
  active,
  direction,
  onSort,
  align = "right",
  className,
}: {
  label: string;
  sortKey?: K;
  active?: K;
  direction?: Direction;
  onSort?: (key: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const sortable = Boolean(sortKey && onSort);
  const isActive = sortable && active === sortKey;
  const Icon = !isActive
    ? ChevronsUpDown
    : direction === "asc"
      ? ChevronUp
      : ChevronDown;
  return (
    <th
      className={cn(
        "text-muted px-4 py-2.5 text-xs font-medium tracking-wide uppercase",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort?.(sortKey as K)}
          className={cn(
            "hover:text-ink inline-flex items-center gap-1 uppercase transition-colors",
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

function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
      <span className="text-muted text-xs">{label}</span>
      <span className={cn("data text-ink text-[15px] font-medium", className)}>
        {value}
      </span>
      {hint && <span className="text-muted text-[11px]">{hint}</span>}
    </div>
  );
}

function useSort<K extends string>(initial: K) {
  const [key, setKey] = useState<K>(initial);
  const [direction, setDirection] = useState<Direction>("desc");
  function onSort(next: K) {
    if (next === key) {
      setDirection(direction === "desc" ? "asc" : "desc");
    } else {
      setKey(next);
      setDirection("desc");
    }
  }
  return { key, direction, onSort };
}

function sortBy<T>(rows: T[], key: keyof T, direction: Direction) {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * (Number(a[key]) - Number(b[key])));
}

/**
 * Position range against the current price, on a log scale shared by every
 * row of the table so bars are comparable. The marker is the pool price.
 */
function RangeBar({
  min,
  max,
  price,
  domain,
  inRange,
}: {
  min: number;
  max: number;
  price: number | null;
  domain: [number, number];
  inRange: boolean | null;
}) {
  const [lo, hi] = domain;
  const span = Math.log(hi) - Math.log(lo) || 1;
  const x = (value: number) =>
    Math.min(120, Math.max(0, ((Math.log(value) - Math.log(lo)) / span) * 120));
  const left = x(min);
  const width = Math.max(2, x(max) - left);
  const color = inRange === false ? "#fbbf24" : "#4ade80";
  return (
    <svg
      width="120"
      height="10"
      viewBox="0 0 120 10"
      aria-hidden
      className="mt-1.5 block"
    >
      <rect x="0" y="4" width="120" height="2" rx="1" className="fill-rule-2" />
      <rect
        x={left}
        y="3"
        width={width}
        height="4"
        rx="2"
        fill={color}
        opacity={0.9}
      />
      {price !== null && price > 0 && (
        <rect
          x={x(price) - 1}
          y="0"
          width="2"
          height="10"
          rx="1"
          className="fill-ink"
        />
      )}
    </svg>
  );
}

function rangeDomain(
  rows: PositionRow[],
  price: number | null,
): [number, number] {
  const values: number[] = [];
  for (const row of rows) {
    if (row.minPrice) values.push(row.minPrice);
    if (row.maxPrice) values.push(row.maxPrice);
  }
  if (price) values.push(price);
  if (values.length === 0) return [1, 10];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? [lo / 2, hi * 2] : [lo * 0.9, hi * 1.1];
}

function HealthBar({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const ratio = total > 0 ? value / total : 0;
  const pct = Math.round(ratio * 100);
  const color = ratio >= 0.5 ? "#4ade80" : "#fbbf24";
  return (
    <div className="border-rule bg-paper-2 flex flex-col gap-2 rounded-xl border px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted text-xs">{label}</span>
        <span className="data text-ink text-sm">
          {total > 0 ? `${pct}%` : "–"}
          <span className="text-muted">
            {" "}
            · {value}/{total}
          </span>
        </span>
      </div>
      <div className="bg-paper-4 h-1.5 w-full overflow-hidden rounded-full">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/* ── Tables ──────────────────────────────────────────────────────── */

function PositionsTable({
  rows,
  pool,
  emptyText,
}: {
  rows: PositionRow[];
  pool: PoolMeta;
  emptyText: string;
}) {
  const sort = useSort<PositionSort>("valueNative");
  const [limit, setLimit] = useState(PAGE);
  const sorted = useMemo(
    () => sortBy(rows, sort.key, sort.direction),
    [rows, sort.key, sort.direction],
  );
  const visible = sorted.slice(0, limit);
  const domain = useMemo(
    () => rangeDomain(rows, pool.currentPrice),
    [rows, pool.currentPrice],
  );

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <thead className="bg-paper-3/50">
            <tr>
              <Th label="Owner / Position ID" align="left" />
              <Th
                label="Value"
                sortKey="valueNative"
                active={sort.key}
                direction={sort.direction}
                onSort={sort.onSort}
              />
              <Th
                label="Fee"
                sortKey="feeNative"
                active={sort.key}
                direction={sort.direction}
                onSort={sort.onSort}
              />
              <Th
                label="uPnL"
                sortKey="pnlNative"
                active={sort.key}
                direction={sort.direction}
                onSort={sort.onSort}
              />
              <Th
                label="Age"
                sortKey="ageHours"
                active={sort.key}
                direction={sort.direction}
                onSort={sort.onSort}
              />
              <Th label="Range" align="left" />
              <Th label="Action" className="w-28" />
            </tr>
          </thead>
          <tbody className="divide-rule divide-y">
            {visible.map((row) => (
              <tr
                key={row.position}
                className="hover:bg-paper-3/40 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <OwnerLink owner={row.owner} />
                    <span className="data text-ink-2 inline-flex items-center gap-1.5">
                      {shortAddress(row.position)}
                      <CopyIcon
                        value={row.position}
                        label="Copy position address"
                      />
                    </span>
                  </div>
                </td>
                <td className="data px-4 py-3 text-right">
                  <span className="text-ink block">
                    {formatSol(row.valueNative)}
                    <SolMark />
                  </span>
                  <span className="text-muted block text-xs">
                    {formatPct(row.shareOfPool * 100)}
                  </span>
                </td>
                <td className="data px-4 py-3 text-right text-[#4ade80]">
                  {formatSol(row.feeNative)}
                  <SolMark />
                </td>
                <td
                  className={cn(
                    "data px-4 py-3 text-right",
                    tone(row.pnlNative),
                  )}
                >
                  <span className="block">
                    {formatSol(row.pnlNative)}
                    <SolMark />
                  </span>
                  <span className="block text-xs">
                    {formatPct(row.pnlPercentNative)}
                  </span>
                </td>
                <td className="text-ink px-4 py-3 text-right whitespace-nowrap">
                  {humanAge(row.ageHours)}
                </td>
                <td className="px-4 py-3">
                  <span className="data text-ink flex items-center gap-2">
                    {row.minPrice !== null && row.maxPrice !== null
                      ? `${formatPrice(row.minPrice)} – ${formatPrice(row.maxPrice)}`
                      : "Full range"}
                    {row.inRange === null ? null : row.inRange ? (
                      <span className="pill pill-ok h-5 text-[11px]">
                        In range
                      </span>
                    ) : (
                      <span className="pill pill-warn h-5 text-[11px]">
                        Out of range
                      </span>
                    )}
                  </span>
                  {row.minPrice !== null && row.maxPrice !== null && (
                    <RangeBar
                      min={row.minPrice}
                      max={row.maxPrice}
                      price={pool.currentPrice}
                      domain={domain}
                      inRange={row.inRange}
                    />
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <CopyRangeButton row={row} pool={pool} />
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted px-4 py-10 text-center">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Footer
        shown={visible.length}
        total={rows.length}
        onMore={() => setLimit((v) => v + PAGE)}
      />
    </>
  );
}

/** Copies the position's setup (pool + range) so it can be replicated by hand. */
function CopyRangeButton({ row, pool }: { row: PositionRow; pool: PoolMeta }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const range =
      row.minPrice !== null && row.maxPrice !== null
        ? `${formatPrice(row.minPrice)} – ${formatPrice(row.maxPrice)} ${pool.tokenY.symbol}/${pool.tokenX.symbol}`
        : "full range";
    const text = `${pool.name} (${pool.protocol === "meteora_dlmm" ? "DLMM" : "DAMM v2"})\npool: ${pool.address}\nrange: ${range}\nowner: ${row.owner}\nposition: ${row.position}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_400);
    } catch {
      // clipboard unavailable
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#22c55e]/50 px-3 text-xs font-medium text-[#4ade80] transition-colors hover:bg-[#22c55e]/10"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function TopLpersTable({ rows }: { rows: WalletRow[] }) {
  const sort = useSort<WalletSort>("pnlNative");
  const [limit, setLimit] = useState(PAGE);
  const sorted = useMemo(
    () => sortBy(rows, sort.key, sort.direction),
    [rows, sort.key, sort.direction],
  );
  const visible = sorted.slice(0, limit);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-paper-3/50">
            <tr>
              <Th label="Owner" align="left" />
              <Th
                label="Total PnL"
                sortKey="pnlNative"
                active={sort.key}
                direction={sort.direction}
                onSort={sort.onSort}
              />
              <Th
                label="Total Fee"
                sortKey="feeNative"
                active={sort.key}
                direction={sort.direction}
                onSort={sort.onSort}
              />
              <Th
                label="Total LP"
                sortKey="positions"
                active={sort.key}
                direction={sort.direction}
                onSort={sort.onSort}
              />
              <Th
                label="Avg Age"
                sortKey="avgAgeHours"
                active={sort.key}
                direction={sort.direction}
                onSort={sort.onSort}
              />
              <Th
                label="Win Rate"
                sortKey="winRate"
                active={sort.key}
                direction={sort.direction}
                onSort={sort.onSort}
              />
            </tr>
          </thead>
          <tbody className="divide-rule divide-y">
            {visible.map((row) => (
              <tr
                key={row.owner}
                className="hover:bg-paper-3/40 transition-colors"
              >
                <td className="px-4 py-3">
                  <OwnerLink owner={row.owner} />
                </td>
                <td
                  className={cn(
                    "data px-4 py-3 text-right font-medium",
                    tone(row.pnlNative),
                  )}
                >
                  {formatSol(row.pnlNative, 2)} SOL
                </td>
                <td className="data text-ink px-4 py-3 text-right font-medium">
                  {formatSol(row.feeNative, 2)} SOL
                </td>
                <td className="data text-ink px-4 py-3 text-right">
                  {row.positions}
                </td>
                <td className="text-ink px-4 py-3 text-right whitespace-nowrap">
                  {humanAge(row.avgAgeHours)}
                </td>
                <td
                  className={cn(
                    "data px-4 py-3 text-right",
                    row.closedPositions === 0
                      ? "text-muted"
                      : row.winRate >= 0.5
                        ? "text-[#4ade80]"
                        : "text-[#fb7185]",
                  )}
                >
                  {row.closedPositions === 0
                    ? "–"
                    : `${(row.winRate * 100).toFixed(2)}%`}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted px-4 py-10 text-center">
                  No liquidity providers found in this pool right now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Footer
        shown={visible.length}
        total={rows.length}
        onMore={() => setLimit((v) => v + PAGE)}
      />
    </>
  );
}

function Footer({
  shown,
  total,
  onMore,
}: {
  shown: number;
  total: number;
  onMore: () => void;
}) {
  return (
    <div className="border-rule text-muted flex items-center justify-center gap-3 border-t px-4 py-2.5 text-xs">
      <span>
        {shown} of {total}
      </span>
      {shown < total && (
        <button
          type="button"
          onClick={onMore}
          className="text-accent hover:text-focus font-medium transition-colors"
        >
          Show more
        </button>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */

export function PoolLpersTable({
  address,
  protocol,
}: {
  address: string;
  protocol?: string;
}) {
  const { account, authenticated, openConnect, configured } = useAuthFlow();
  const [data, setData] = useState<PoolLpersResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("positions");

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (protocol) params.set("protocol", protocol);
        if (refresh) params.set("refresh", "1");
        const response = await fetch(
          `/api/pools/${address}/lpers${params.size ? `?${params}` : ""}`,
        );
        const payload = (await response.json()) as PoolLpersResponse;
        if (!response.ok) {
          throw new Error(payload.message || `HTTP ${response.status}`);
        }
        setData(payload);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load pool");
      } finally {
        setLoading(false);
      }
    },
    [address, protocol],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const myWallets = useMemo(() => {
    const set = new Set<string>();
    if (account?.agentWallet) set.add(account.agentWallet.address);
    for (const wallet of account?.ownerWallets ?? []) set.add(wallet.address);
    return set;
  }, [account]);

  const myPositions = useMemo(
    () =>
      data ? data.positions.filter((row) => myWallets.has(row.owner)) : [],
    [data, myWallets],
  );

  const pool = data?.pool;
  const totals = data?.totals;
  const isDlmm = pool
    ? pool.protocol === "meteora_dlmm"
    : protocol !== "damm_v2";
  const meteoraUrl = isDlmm
    ? `https://app.meteora.ag/dlmm/${address}`
    : `https://app.meteora.ag/damm-v2/${address}`;

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    {
      key: "positions",
      label: "Positions In Pool",
      count: data?.positions.length,
    },
    { key: "top", label: "Top LPer", count: data?.wallets.length },
    {
      key: "mine",
      label: "Your Positions",
      count: authenticated ? myPositions.length : undefined,
    },
  ];

  return (
    <main className="mx-auto flex w-full max-w-[var(--page-max)] flex-1 flex-col gap-5 px-[var(--page-gutter)] py-6">
      {/* Header */}
      <section className="flex flex-col gap-3">
        <Link
          href="/pool"
          className="text-muted hover:text-ink inline-flex w-fit items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Pools
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            {pool ? (
              <span className="flex shrink-0 -space-x-2.5">
                <TokenLogo token={pool.tokenX} />
                <TokenLogo token={pool.tokenY} />
              </span>
            ) : (
              <span className="bg-paper-3 h-8 w-14 animate-pulse rounded-full" />
            )}
            <h1 className="text-ink truncate text-2xl font-semibold tracking-tight">
              {pool?.name ?? shortAddress(address)}
            </h1>
            <span className="pill pill-accent">
              {isDlmm ? "DLMM" : "DAMM v2"}
            </span>
            {pool?.baseFeePct ? (
              <span className="pill">fee {pool.baseFeePct}%</span>
            ) : null}
            {pool?.binStep ? (
              <span className="pill">bin {pool.binStep}</span>
            ) : null}
          </div>
          <div className="text-muted flex items-center gap-1 font-mono text-xs">
            <span className="hidden sm:inline">{address}</span>
            <span className="sm:hidden">{shortAddress(address)}</span>
            <CopyIcon value={address} label="Copy pool address" />
            <a
              href={`https://solscan.io/account/${address}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink inline-flex items-center gap-1 px-1.5 transition-colors"
            >
              Solscan <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              aria-label="Refresh"
              title="Refresh"
              className="border-rule text-ink-2 hover:border-rule-2 hover:text-ink inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors disabled:opacity-50"
            >
              {loading ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>
            <a
              href={meteoraUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#22c55e] px-3.5 text-sm font-medium text-[#04150a] transition-colors hover:bg-[#4ade80]"
            >
              <Plus className="h-4 w-4" />
              Add Liquidity
            </a>
          </div>
        </div>
        {pool && (
          <p className="text-muted data text-xs">
            1 {pool.tokenX.symbol} = {formatPrice(pool.currentPrice)}{" "}
            {pool.tokenY.symbol}
            {pool.createdAtMs
              ? ` · created ${humanAge((Date.now() - pool.createdAtMs) / 3_600_000)} ago`
              : ""}
          </p>
        )}
      </section>

      {/* Stats strip */}
      <section className="border-rule bg-paper-2 divide-rule grid grid-cols-2 divide-x divide-y rounded-xl border sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        <Stat label="TVL" value={pool ? usd.format(pool.tvl) : "–"} />
        <Stat
          label="Volume 24h"
          value={pool ? usd.format(pool.volume24h) : "–"}
          hint={pool ? `fees ${usd.format(pool.fees24h)}` : undefined}
        />
        <Stat
          label="Fee / TVL 24h"
          value={pool ? `${(pool.feeTvl24h * 100).toFixed(2)}%` : "–"}
          hint={
            pool
              ? `≈ ${(pool.feeTvl24h * 365 * 100).toFixed(0)}% APR`
              : undefined
          }
          className={
            pool && pool.feeTvl24h * 100 >= 1 ? "text-[#4ade80]" : undefined
          }
        />
        <Stat
          label="LP wallets"
          value={totals ? totals.walletsOnChain.toLocaleString() : "–"}
          hint={
            totals ? `${totals.openPositionsOnChain} open positions` : undefined
          }
        />
        <Stat
          label="Net PnL of LPs"
          value={totals ? usd.format(totals.pnlUsd) : "–"}
          hint={
            totals ? `on ${usd.format(totals.depositUsd)} deposited` : undefined
          }
          className={totals ? tone(totals.pnlUsd) : undefined}
        />
        <Stat
          label="Winners / losers"
          value={totals ? `${totals.winners} / ${totals.losers}` : "–"}
          hint={
            totals && totals.walletsAnalyzed > 0
              ? `${Math.round((totals.winners / totals.walletsAnalyzed) * 100)}% in profit`
              : undefined
          }
        />
      </section>

      {data?.warnings.length ? (
        <p className="text-muted -mt-2 text-xs">
          {data.warnings.slice(0, 3).join(" · ")}
        </p>
      ) : null}

      {data && data.positions.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-2">
          <HealthBar
            label="Positions in range"
            value={data.positions.filter((row) => row.inRange === true).length}
            total={data.positions.filter((row) => row.inRange !== null).length}
          />
          <HealthBar
            label="Wallets in profit in this pool"
            value={data.totals.winners}
            total={data.totals.winners + data.totals.losers}
          />
        </section>
      )}

      {/* Tabs + table */}
      <section className="border-rule bg-paper-2 overflow-hidden rounded-xl border">
        <div className="border-rule flex flex-wrap items-center gap-2 border-b px-2 pr-3">
          <div role="tablist" className="flex items-center overflow-x-auto">
            {tabs.map((item) => {
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(item.key)}
                  className={cn(
                    "relative inline-flex h-12 items-center gap-2 px-3 text-sm whitespace-nowrap transition-colors",
                    active
                      ? "text-ink font-medium"
                      : "text-muted hover:text-ink",
                  )}
                >
                  {item.label}
                  {typeof item.count === "number" && (
                    <span
                      className={cn(
                        "data rounded-md px-1.5 py-0.5 text-[11px]",
                        active
                          ? "bg-accent-soft text-accent"
                          : "bg-paper-3 text-muted",
                      )}
                    >
                      {item.count}
                    </span>
                  )}
                  {active && (
                    <span
                      aria-hidden
                      className="bg-accent absolute inset-x-3 bottom-0 h-0.5 rounded-full"
                    />
                  )}
                </button>
              );
            })}
          </div>
          {data && (
            <span className="text-muted ml-auto text-xs">
              updated{" "}
              {humanAge(
                (Date.now() - Date.parse(data.generatedAt)) / 3_600_000,
              )}{" "}
              ago
            </span>
          )}
        </div>

        {loading && !data ? (
          <div className="divide-rule divide-y">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="px-4 py-3.5">
                <div
                  className="bg-paper-3 h-4 animate-pulse rounded"
                  style={{ width: `${50 + ((index * 23) % 45)}%` }}
                />
              </div>
            ))}
            <p className="text-muted px-4 py-3 text-center text-xs">
              Reading positions on-chain and computing PnL per wallet…
            </p>
          </div>
        ) : error ? (
          <p className="px-4 py-10 text-center text-sm text-[#fb7185]">
            {error}
          </p>
        ) : data && pool ? (
          tab === "positions" ? (
            <PositionsTable
              rows={data.positions}
              pool={pool}
              emptyText="No open positions in this pool right now."
            />
          ) : tab === "top" ? (
            <TopLpersTable rows={data.wallets} />
          ) : !authenticated ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <p className="text-muted text-sm">
                Sign in to see your own positions in this pool.
              </p>
              {configured && (
                <button
                  type="button"
                  onClick={openConnect}
                  className="bg-accent text-accent-ink hover:bg-focus inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium transition-colors"
                >
                  Connect wallet
                </button>
              )}
            </div>
          ) : (
            <PositionsTable
              rows={myPositions}
              pool={pool}
              emptyText="None of your wallets has an open position in this pool."
            />
          )
        ) : null}
      </section>
    </main>
  );
}
