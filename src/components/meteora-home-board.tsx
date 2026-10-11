"use client";

import { useMemo, useState } from "react";
import { Filter, Flame, Sparkles, TrendingUp, Zap } from "lucide-react";

import { cn } from "@/lib/utils";

interface MeteoraTokenInfo {
  symbol?: string;
  icon?: string;
  market_cap?: number;
}

interface DlmmParams {
  bin_step?: number;
}

export interface MeteoraHomePoolItem {
  pool_address?: string;
  name?: string;
  pool_type?: string;
  fee_pct?: number;
  dlmm_params?: DlmmParams | null;
  token_x?: MeteoraTokenInfo;
  token_y?: MeteoraTokenInfo;
  tvl?: number;
  tvl_change_pct?: number;
  pool_created_at?: number;
  fee?: number;
  fee_change_pct?: number;
  pool_price?: number;
  pool_price_change_pct?: number;
  active_tvl?: number;
  active_tvl_change_pct?: number;
  fee_active_tvl_ratio?: number;
  volume?: number;
  volume_change_pct?: number;
  volume_active_tvl_ratio?: number;
  swap_count?: number;
  swap_count_change_pct?: number;
  unique_traders?: number;
  unique_traders_change_pct?: number;
  total_lps?: number;
  total_lps_change_pct?: number;
  net_deposits?: number;
  base_token_holders?: number;
  price_trend?: Array<number | string>;
}

type BoardTab = "top" | "trending" | "new";

const TIMEFRAME_OPTIONS = ["5m", "30m", "1H", "2H", "4H", "12H", "24H"];

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatUsdCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedPercent(value: unknown, fractionDigits = 2) {
  const parsed = toNumber(value, 0);
  const sign = parsed > 0 ? "+" : "";
  return `${sign}${parsed.toFixed(fractionDigits)}%`;
}

function formatPoolPrice(value: unknown) {
  const parsed = toNumber(value, 0);
  if (parsed === 0) {
    return "0";
  }
  if (parsed >= 1) {
    return parsed.toFixed(4);
  }
  if (parsed >= 0.01) {
    return parsed.toFixed(6);
  }
  return parsed.toFixed(8);
}

function formatAge(createdAtMs: unknown) {
  const timestamp = toNumber(createdAtMs, 0);
  if (!timestamp) {
    return "-";
  }

  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  const minuteMs = 60_000;
  const hourMs = 3_600_000;
  const dayMs = 86_400_000;

  if (diff < hourMs) {
    const mins = Math.max(1, Math.floor(diff / minuteMs));
    return `${mins}m`;
  }

  if (diff < dayMs) {
    const hours = Math.floor(diff / hourMs);
    const mins = Math.floor((diff % hourMs) / minuteMs);
    return `${hours}h ${mins}m`;
  }

  const days = Math.floor(diff / dayMs);
  const hours = Math.floor((diff % dayMs) / hourMs);
  return `${days}d ${hours}h`;
}

function shortAddress(value: string, head = 6, tail = 4) {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function getPairLabel(pool: MeteoraHomePoolItem) {
  const base = pool.token_x?.symbol?.trim();
  const quote = pool.token_y?.symbol?.trim();
  if (base && quote) {
    return `${base}-${quote}`;
  }

  return pool.name?.trim() || "-";
}

function getTrendValues(pool: MeteoraHomePoolItem) {
  if (!Array.isArray(pool.price_trend)) {
    return [] as number[];
  }

  return pool.price_trend.map((item) => toNumber(item, 0)).filter((item) => Number.isFinite(item));
}

function TrendSparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <p className="text-xs text-zinc-500">-</p>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1e-9);
  const first = values[0];
  const last = values[values.length - 1];
  const up = last >= first;

  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 30 - ((value - min) / range) * 24;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 32" className="h-8 w-24">
      <polyline
        points={points}
        fill="none"
        stroke={up ? "#22c55e" : "#ef4444"}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TokenIcon({
  icon,
  symbol,
}: {
  icon?: string;
  symbol?: string;
}) {
  const fallback = symbol?.trim().slice(0, 1).toUpperCase() || "?";

  if (icon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt={symbol || "token"}
        className="h-5 w-5 rounded-full border border-[#263044] bg-[#0f1728] object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#263044] bg-[#0f1728] text-[10px] font-semibold text-zinc-300">
      {fallback}
    </span>
  );
}

export function MeteoraHomeBoard({ pools }: { pools: MeteoraHomePoolItem[] }) {
  const [tab, setTab] = useState<BoardTab>("top");
  const [timeframe, setTimeframe] = useState("2H");
  const [searchTerm, setSearchTerm] = useState("");

  const totals = useMemo(() => {
    return pools.reduce<{ tvl: number; volume: number; fee: number }>(
      (acc, pool) => {
        acc.tvl += toNumber(pool.tvl);
        acc.volume += toNumber(pool.volume);
        acc.fee += toNumber(pool.fee);
        return acc;
      },
      { tvl: 0, volume: 0, fee: 0 },
    );
  }, [pools]);

  const displayRows = useMemo(() => {
    const normalizedQuery = searchTerm.trim().toLowerCase();

    const filtered = pools.filter((pool) => {
      if (!normalizedQuery) {
        return true;
      }

      const pair = getPairLabel(pool).toLowerCase();
      const base = pool.token_x?.symbol?.toLowerCase() || "";
      const quote = pool.token_y?.symbol?.toLowerCase() || "";
      const address = pool.pool_address?.toLowerCase() || "";

      return (
        pair.includes(normalizedQuery) ||
        base.includes(normalizedQuery) ||
        quote.includes(normalizedQuery) ||
        address.includes(normalizedQuery)
      );
    });

    const sorted = [...filtered];

    if (tab === "top") {
      sorted.sort(
        (a, b) =>
          toNumber(b.fee_active_tvl_ratio) - toNumber(a.fee_active_tvl_ratio),
      );
    } else if (tab === "trending") {
      sorted.sort((a, b) => toNumber(b.volume_change_pct) - toNumber(a.volume_change_pct));
    } else {
      sorted.sort((a, b) => toNumber(b.pool_created_at) - toNumber(a.pool_created_at));
    }

    return sorted.slice(0, 80);
  }, [pools, searchTerm, tab]);

  const maxAbsNetDeposit = useMemo(() => {
    return Math.max(1, ...displayRows.map((pool) => Math.abs(toNumber(pool.net_deposits))));
  }, [displayRows]);

  const tabItems = [
    {
      key: "top" as const,
      label: "Top Performers",
      icon: Flame,
    },
    {
      key: "trending" as const,
      label: "Trending",
      icon: TrendingUp,
    },
    {
      key: "new" as const,
      label: "New Tokens",
      icon: Sparkles,
    },
  ];

  return (
    <main className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col gap-5 px-3 py-5 sm:px-4 lg:px-6">
      <section className="overflow-hidden rounded-2xl border border-[#222a3a] bg-[linear-gradient(160deg,#0c1120_0%,#0a0f1b_60%,#0a1321_100%)] p-5 shadow-[0_18px_45px_rgba(2,8,23,0.45)]">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <p className="text-xs font-semibold tracking-widest text-cyan-300 uppercase">
              Meteora Discovery Board
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
              We build liquidity pools
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Theo dõi pool nổi bật, volume, fees, crowding và biến động để tìm setup LP tốt hơn.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-orange-400/40 bg-orange-400/15 px-3 py-2 text-xs font-medium text-orange-200"
              >
                <Sparkles className="h-3.5 w-3.5" />
                New to LP? Start Here!
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-indigo-400/40 bg-indigo-400/15 px-3 py-2 text-xs font-medium text-indigo-200"
              >
                <Flame className="h-3.5 w-3.5" />
                Join the LP Army
              </button>
            </div>
          </div>

          <div className="grid w-full gap-2 sm:w-[360px] sm:grid-cols-3">
            <article className="rounded-xl border border-[#283247] bg-[#0d1527]/70 p-3 text-right">
              <p className="text-[11px] tracking-wide text-zinc-500 uppercase">Total Value Locked</p>
              <p className="mt-1 text-sm font-semibold text-zinc-100">{formatUsdCompact(totals.tvl)}</p>
            </article>
            <article className="rounded-xl border border-[#283247] bg-[#0d1527]/70 p-3 text-right">
              <p className="text-[11px] tracking-wide text-zinc-500 uppercase">Swap Volume</p>
              <p className="mt-1 text-sm font-semibold text-zinc-100">{formatUsdCompact(totals.volume)}</p>
            </article>
            <article className="rounded-xl border border-[#283247] bg-[#0d1527]/70 p-3 text-right">
              <p className="text-[11px] tracking-wide text-zinc-500 uppercase">Fees Generated</p>
              <p className="mt-1 text-sm font-semibold text-zinc-100">{formatUsdCompact(totals.fee)}</p>
            </article>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[#222a3a] bg-[#0b111f]/95 shadow-[0_16px_45px_rgba(2,8,23,0.38)]">
        <div className="flex flex-col gap-3 border-b border-[#1b2436] px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {tabItems.map((item) => {
              const Icon = item.icon;
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition",
                    active
                      ? "border-orange-400/50 bg-orange-400/15 text-orange-200"
                      : "border-transparent text-zinc-400 hover:border-[#2e3a55] hover:bg-[#121b2f] hover:text-zinc-200",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="inline-flex rounded-lg border border-[#2a3245] bg-[#10182b] p-1">
              {TIMEFRAME_OPTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTimeframe(item)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
                    timeframe === item
                      ? "bg-[#202c48] text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search pair / token / address"
                className="h-9 w-56 rounded-lg border border-[#2a3245] bg-[#10182b] px-3 text-xs text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-cyan-500"
              />
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#2a3245] bg-[#10182b] px-3 text-xs font-medium text-zinc-300"
              >
                <Filter className="h-3.5 w-3.5" />
                Filter
              </button>
            </div>
          </div>
        </div>

        <div className="px-3 pb-2 pt-2 text-xs text-zinc-500">
          Snapshot source: Meteora `2h`. Timeframe selected `{timeframe}` chỉ dùng để tham chiếu UI.
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1960px] text-xs">
            <thead className="border-y border-[#1b2436] bg-[#0f1729] text-[11px] tracking-wide text-zinc-500 uppercase">
              <tr>
                <th className="px-3 py-3 text-left">Pools</th>
                <th className="px-3 py-3 text-left">Price Trend</th>
                <th className="px-3 py-3 text-right">TVL</th>
                <th className="px-3 py-3 text-left">Token Age</th>
                <th className="px-3 py-3 text-right">Market Cap</th>
                <th className="px-3 py-3 text-right">Fees</th>
                <th className="px-3 py-3 text-right">Pool Price</th>
                <th className="px-3 py-3 text-right">Active TVL</th>
                <th className="px-3 py-3 text-right">Fees/Active TVL</th>
                <th className="px-3 py-3 text-right">Volume</th>
                <th className="px-3 py-3 text-right">Volume/Active TVL</th>
                <th className="px-3 py-3 text-right">Swaps</th>
                <th className="px-3 py-3 text-right">Traders</th>
                <th className="px-3 py-3 text-right">Total LPs</th>
                <th className="px-3 py-3 text-right">Net Deposit</th>
                <th className="px-3 py-3 text-right">Holders</th>
                <th className="px-3 py-3 text-center">Ape In</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#182133]">
              {displayRows.map((pool, index) => {
                const netDeposit = toNumber(pool.net_deposits);
                const trendValues = getTrendValues(pool);
                const netWeight = Math.min(100, (Math.abs(netDeposit) / maxAbsNetDeposit) * 100);
                const pair = getPairLabel(pool);

                return (
                  <tr
                    key={`${pool.pool_address || pool.name || "pool"}-${index}`}
                    className="bg-[#0b1221] transition hover:bg-[#0f1a30]"
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <p className="pt-1 font-mono text-[11px] text-zinc-500">#{index + 1}</p>
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center -space-x-1">
                              <TokenIcon icon={pool.token_x?.icon} symbol={pool.token_x?.symbol} />
                              <TokenIcon icon={pool.token_y?.icon} symbol={pool.token_y?.symbol} />
                            </div>
                            <p className="text-[13px] font-semibold text-zinc-100">{pair}</p>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300 uppercase">
                              {pool.pool_type || "pool"}
                            </span>
                            <span className="text-[10px] text-zinc-500">
                              Fee: {toNumber(pool.fee_pct).toFixed(2)}%{" "}
                              {pool.dlmm_params?.bin_step ? `• Bin Step ${pool.dlmm_params.bin_step}` : ""}
                            </span>
                          </div>
                          {pool.pool_address && (
                            <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
                              {shortAddress(pool.pool_address, 8, 8)}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-2.5">
                      <TrendSparkline values={trendValues} />
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <p className="font-semibold text-zinc-100">{formatUsdCompact(toNumber(pool.tvl))}</p>
                      <p
                        className={cn(
                          "text-[10px]",
                          toNumber(pool.tvl_change_pct) >= 0 ? "text-emerald-400" : "text-rose-400",
                        )}
                      >
                        {formatSignedPercent(pool.tvl_change_pct)}
                      </p>
                    </td>

                    <td className="px-3 py-2.5 text-zinc-300">{formatAge(pool.pool_created_at)}</td>

                    <td className="px-3 py-2.5 text-right">
                      <p className="font-semibold text-zinc-100">
                        {formatUsdCompact(toNumber(pool.token_x?.market_cap))}
                      </p>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <p className="font-semibold text-zinc-100">{formatUsdCompact(toNumber(pool.fee))}</p>
                      <p
                        className={cn(
                          "text-[10px]",
                          toNumber(pool.fee_change_pct) >= 0 ? "text-emerald-400" : "text-rose-400",
                        )}
                      >
                        {formatSignedPercent(pool.fee_change_pct)}
                      </p>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <p className="font-semibold text-zinc-100">{formatPoolPrice(pool.pool_price)}</p>
                      <p
                        className={cn(
                          "text-[10px]",
                          toNumber(pool.pool_price_change_pct) >= 0
                            ? "text-emerald-400"
                            : "text-rose-400",
                        )}
                      >
                        {formatSignedPercent(pool.pool_price_change_pct)}
                      </p>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <p className="font-semibold text-zinc-100">{formatUsdCompact(toNumber(pool.active_tvl))}</p>
                      <p
                        className={cn(
                          "text-[10px]",
                          toNumber(pool.active_tvl_change_pct) >= 0
                            ? "text-emerald-400"
                            : "text-rose-400",
                        )}
                      >
                        {formatSignedPercent(pool.active_tvl_change_pct)}
                      </p>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <p className="font-semibold text-zinc-100">
                        {toNumber(pool.fee_active_tvl_ratio).toFixed(2)}%
                      </p>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <p className="font-semibold text-zinc-100">{formatUsdCompact(toNumber(pool.volume))}</p>
                      <p
                        className={cn(
                          "text-[10px]",
                          toNumber(pool.volume_change_pct) >= 0
                            ? "text-emerald-400"
                            : "text-rose-400",
                        )}
                      >
                        {formatSignedPercent(pool.volume_change_pct)}
                      </p>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <p className="font-semibold text-zinc-100">
                        {(toNumber(pool.volume_active_tvl_ratio) * 100).toFixed(0)}%
                      </p>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <p className="font-semibold text-zinc-100">
                        {toNumber(pool.swap_count).toLocaleString()}
                      </p>
                      <p
                        className={cn(
                          "text-[10px]",
                          toNumber(pool.swap_count_change_pct) >= 0
                            ? "text-emerald-400"
                            : "text-rose-400",
                        )}
                      >
                        {formatSignedPercent(pool.swap_count_change_pct)}
                      </p>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <p className="font-semibold text-zinc-100">
                        {toNumber(pool.unique_traders).toLocaleString()}
                      </p>
                      <p
                        className={cn(
                          "text-[10px]",
                          toNumber(pool.unique_traders_change_pct) >= 0
                            ? "text-emerald-400"
                            : "text-rose-400",
                        )}
                      >
                        {formatSignedPercent(pool.unique_traders_change_pct)}
                      </p>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <p className="font-semibold text-zinc-100">
                        {toNumber(pool.total_lps).toLocaleString()}
                      </p>
                      <p
                        className={cn(
                          "text-[10px]",
                          toNumber(pool.total_lps_change_pct) >= 0
                            ? "text-emerald-400"
                            : "text-rose-400",
                        )}
                      >
                        {formatSignedPercent(pool.total_lps_change_pct)}
                      </p>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <p
                        className={cn(
                          "font-semibold",
                          netDeposit >= 0 ? "text-emerald-400" : "text-rose-400",
                        )}
                      >
                        {formatUsdCompact(netDeposit)}
                      </p>
                      <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-[#1b253a] ml-auto">
                        <div
                          className={cn("h-full", netDeposit >= 0 ? "bg-emerald-400" : "bg-rose-400")}
                          style={{ width: `${Math.max(8, netWeight)}%` }}
                        />
                      </div>
                    </td>

                    <td className="px-3 py-2.5 text-right font-semibold text-zinc-100">
                      {toNumber(pool.base_token_holders).toLocaleString()}
                    </td>

                    <td className="px-3 py-2.5 text-center">
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-indigo-400/35 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25"
                      >
                        <Zap className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={17} className="px-3 py-10 text-center text-sm text-zinc-500">
                    Không tìm thấy pool phù hợp.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
