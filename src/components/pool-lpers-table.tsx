"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";

import { cn } from "@/lib/utils";

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
  currentPrice: number | null;
  createdAtMs: number | null;
}

interface WalletRow {
  owner: string;
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
  firstActivity: string | null;
  lastActivity: string | null;
}

interface PoolLpersResponse {
  pool: PoolMeta;
  generatedAt: string;
  totals: {
    openPositionsOnChain: number;
    walletsOnChain: number;
    walletsAnalyzed: number;
    walletsSkipped: number;
    depositUsd: number;
    pnlUsd: number;
    feeUsd: number;
    winners: number;
    losers: number;
  };
  wallets: WalletRow[];
  warnings: string[];
  rpc: "public" | "custom";
  message?: string;
}

type SortKey =
  | "pnlUsd"
  | "pnlNative"
  | "pnlPercent"
  | "depositUsd"
  | "feeUsd"
  | "positions"
  | "lastActivity";

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "pnlUsd", label: "PnL (USD)" },
  { key: "pnlNative", label: "PnL (SOL)" },
  { key: "pnlPercent", label: "PnL %" },
  { key: "depositUsd", label: "Deposited" },
  { key: "feeUsd", label: "Fees earned" },
  { key: "positions", label: "Positions" },
  { key: "lastActivity", label: "Last activity" },
];

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdFine = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const sol = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function shortAddress(value: string, size = 4) {
  return value.length <= size * 2 + 3
    ? value
    : `${value.slice(0, size)}…${value.slice(-size)}`;
}

function relativeTime(iso: string | null) {
  if (!iso) return "-";
  const diff = Date.now() - Date.parse(iso);
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function pnlClass(value: number) {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-rose-400";
  return "text-zinc-300";
}

function TokenLogo({ token }: { token: TokenInfo }) {
  const [broken, setBroken] = useState(false);
  if (token.logo && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={token.logo}
        alt={token.symbol}
        className="h-7 w-7 rounded-full border border-zinc-700 bg-zinc-900 object-cover"
        onError={() => setBroken(true)}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xs font-semibold text-zinc-300">
      {token.symbol.slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <article className="rounded-xl border border-zinc-800 bg-[#0a0f16] p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold text-zinc-100", tone)}>
        {value}
      </p>
    </article>
  );
}

export function PoolLpersTable({
  address,
  protocol,
}: {
  address: string;
  protocol?: string;
}) {
  const [data, setData] = useState<PoolLpersResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("pnlUsd");
  const [query, setQuery] = useState("");

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

  const rows = useMemo(() => {
    if (!data) return [];
    const term = query.trim().toLowerCase();
    const filtered = term
      ? data.wallets.filter((row) => row.owner.toLowerCase().includes(term))
      : data.wallets;
    return [...filtered].sort((a, b) => {
      if (sortKey === "lastActivity") {
        return (
          Date.parse(b.lastActivity ?? "") - Date.parse(a.lastActivity ?? "")
        );
      }
      return b[sortKey] - a[sortKey];
    });
  }, [data, query, sortKey]);

  const pool = data?.pool;

  return (
    <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-zinc-800 bg-[#0d1118] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/pool"
              className="text-xs font-medium tracking-wide text-zinc-400 uppercase hover:text-zinc-200"
            >
              ← Meteora Pools
            </Link>
            <div className="mt-2 flex items-center gap-3">
              {pool ? (
                <span className="flex -space-x-2">
                  <TokenLogo token={pool.tokenX} />
                  <TokenLogo token={pool.tokenY} />
                </span>
              ) : null}
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
                {pool?.name ?? shortAddress(address, 6)}
              </h1>
              {pool && (
                <span className="rounded-full border border-zinc-700 px-2 py-0.5 font-mono text-[11px] text-zinc-400 uppercase">
                  {pool.protocol === "meteora_dlmm" ? "DLMM" : "DAMM v2"}
                </span>
              )}
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-zinc-500">
              <span className="truncate">{address}</span>
              <a
                href={`https://solscan.io/account/${address}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-zinc-200"
              >
                Solscan <ExternalLink className="h-3 w-3" />
              </a>
              {pool && (
                <a
                  href={
                    pool.protocol === "meteora_dlmm"
                      ? `https://app.meteora.ag/dlmm/${address}`
                      : `https://app.meteora.ag/damm-v2/${address}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-zinc-200"
                >
                  Meteora <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-700 px-3 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50"
          >
            {loading ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
        </div>

        {pool && data && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="TVL" value={usd.format(pool.tvl)} />
            <StatCard label="Volume 24h" value={usd.format(pool.volume24h)} />
            <StatCard
              label="LP wallets on-chain"
              value={data.totals.walletsOnChain.toLocaleString()}
            />
            <StatCard
              label="Open positions"
              value={data.totals.openPositionsOnChain.toLocaleString()}
            />
            <StatCard
              label="Net PnL of LPs"
              value={usd.format(data.totals.pnlUsd)}
              tone={pnlClass(data.totals.pnlUsd)}
            />
            <StatCard
              label="Winners / losers"
              value={`${data.totals.winners} / ${data.totals.losers}`}
            />
          </div>
        )}

        {data?.warnings.length ? (
          <ul className="mt-3 space-y-1 text-xs text-amber-400/90">
            {data.warnings.slice(0, 4).map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-[#0d1118]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <p className="text-sm text-zinc-300">
            Wallets currently in this pool
            {data ? (
              <span className="text-zinc-500">
                {" "}
                · {rows.length} shown · PnL includes every position the wallet
                ever had here
              </span>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by address"
                className="h-9 w-56 rounded-lg border border-zinc-800 bg-[#080b12] pr-3 pl-8 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-500"
              />
            </label>
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
              className="h-9 rounded-lg border border-zinc-800 bg-[#080b12] px-2 text-xs text-zinc-200 outline-none focus:border-emerald-500"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  Sort: {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1080px] divide-y divide-zinc-800 text-sm">
            <thead className="bg-[#0f1420] text-xs text-zinc-400 uppercase">
              <tr>
                <th className="px-3 py-3 text-left">#</th>
                <th className="px-3 py-3 text-left">Wallet</th>
                <th className="px-3 py-3 text-right">Positions</th>
                <th className="px-3 py-3 text-right">Deposited</th>
                <th className="px-3 py-3 text-right">Fees earned</th>
                <th className="px-3 py-3 text-right">PnL (USD)</th>
                <th className="px-3 py-3 text-right">PnL (SOL)</th>
                <th className="px-3 py-3 text-right">PnL %</th>
                <th className="px-3 py-3 text-right">Win rate</th>
                <th className="px-3 py-3 text-left">Range</th>
                <th className="px-3 py-3 text-right">Last activity</th>
                <th className="px-3 py-3 text-right">Analyze</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {loading && !data && (
                <tr>
                  <td
                    colSpan={12}
                    className="px-3 py-10 text-center text-zinc-500"
                  >
                    <LoaderCircle className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    Reading positions on-chain and computing PnL per wallet…
                  </td>
                </tr>
              )}
              {error && (
                <tr>
                  <td
                    colSpan={12}
                    className="px-3 py-8 text-center text-rose-400"
                  >
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={12}
                    className="px-3 py-8 text-center text-zinc-500"
                  >
                    No open LP positions found in this pool right now.
                  </td>
                </tr>
              )}
              {rows.map((row, index) => (
                <tr key={row.owner} className="hover:bg-zinc-900/40">
                  <td className="px-3 py-3 text-zinc-500">{index + 1}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-mono text-xs text-zinc-100"
                        title={row.owner}
                      >
                        {shortAddress(row.owner, 5)}
                      </span>
                      <a
                        href={`https://solscan.io/account/${row.owner}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open wallet on Solscan"
                        className="text-zinc-500 hover:text-zinc-200"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-300">
                    {row.positions}
                    <span className="text-zinc-500">
                      {" "}
                      ({row.openPositions} open)
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-200">
                    {usd.format(row.depositUsd)}
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-200">
                    {usdFine.format(row.feeUsd)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-3 text-right font-medium",
                      pnlClass(row.pnlUsd),
                    )}
                  >
                    {usdFine.format(row.pnlUsd)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-3 text-right",
                      pnlClass(row.pnlNative),
                    )}
                  >
                    {sol.format(row.pnlNative)} SOL
                  </td>
                  <td
                    className={cn(
                      "px-3 py-3 text-right",
                      pnlClass(row.pnlPercent),
                    )}
                  >
                    {row.pnlPercent.toFixed(2)}%
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-300">
                    {row.closedPositions > 0
                      ? `${Math.round(row.winRate * 100)}%`
                      : "-"}
                  </td>
                  <td className="px-3 py-3">
                    {row.inRange === null ? (
                      <span className="text-zinc-500">-</span>
                    ) : row.inRange ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                        in range
                      </span>
                    ) : (
                      <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-xs text-rose-400">
                        out of range
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-zinc-400">
                    {relativeTime(row.lastActivity)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link
                      href={`/analysis?owner=${row.owner}`}
                      className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
                    >
                      Analyze <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
