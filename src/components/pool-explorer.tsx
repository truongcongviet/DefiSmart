"use client";

import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Droplets,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export interface ExplorerToken {
  symbol?: string;
  icon?: string;
  is_verified?: boolean;
}

export interface ExplorerPool {
  pool_address?: string;
  name?: string;
  pool_type?: string;
  token_x?: ExplorerToken;
  token_y?: ExplorerToken;
  tvl?: number;
  active_tvl?: number;
  volume?: number;
  fee?: number;
  fee_pct?: number;
  fee_active_tvl_ratio?: number;
  pool_created_at?: number;
  is_blacklisted?: boolean;
}

type SortKey = "fee_active_tvl_ratio" | "volume" | "tvl";
type Protocol = "all" | "dlmm" | "damm_v2";

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

function protocolLabel(type?: string) {
  return type === "damm_v2" ? "Meteora DAMM v2" : "Meteora DLMM";
}

interface Tag {
  label: string;
  tone: "ok" | "accent" | "warn" | "danger" | "neutral";
}

function tagsFor(pool: ExplorerPool): Tag[] {
  const tags: Tag[] = [];
  const verified =
    pool.token_x?.is_verified === true && pool.token_y?.is_verified === true;
  const tvl = toNumber(pool.tvl);
  const ratio = toNumber(pool.fee_active_tvl_ratio);
  const ageDays = pool.pool_created_at
    ? (Date.now() - toNumber(pool.pool_created_at)) / 86_400_000
    : null;

  if (pool.is_blacklisted) {
    tags.push({ label: "Blacklisted", tone: "danger" });
  } else if (verified && tvl >= 100_000) {
    tags.push({ label: "Low risk", tone: "ok" });
  } else if (!verified) {
    tags.push({ label: "Unverified token", tone: "warn" });
  } else {
    tags.push({ label: "Mid risk", tone: "neutral" });
  }

  if (ratio >= 2) {
    tags.push({ label: "High yield", tone: "accent" });
  } else if (ratio >= 0.5) {
    tags.push({ label: "Stable yield", tone: "accent" });
  } else if (ageDays !== null && ageDays <= 7) {
    tags.push({ label: "New pool", tone: "accent" });
  }

  return tags.slice(0, 2);
}

function TokenIcon({ token }: { token?: ExplorerToken }) {
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
        className="border-paper-2 bg-paper-3 h-7 w-7 rounded-full border-2 object-cover"
      />
    );
  }
  return (
    <span className="border-paper-2 bg-paper-4 text-ink-2 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 text-[11px] font-semibold">
      {symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}

function SortHeader({
  label,
  active,
  direction,
  onClick,
  align = "right",
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  const Icon = !active
    ? ChevronsUpDown
    : direction === "asc"
      ? ChevronUp
      : ChevronDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "hover:text-ink inline-flex items-center gap-1 transition-colors",
        active ? "text-ink" : "text-muted",
        align === "right" ? "flex-row-reverse" : "",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

const selectClass =
  "border-rule bg-paper-2 text-ink hover:border-rule-2 focus-visible:border-rule-2 h-10 appearance-none rounded-lg border py-0 pr-9 pl-3 text-sm outline-none transition-colors";

export function PoolExplorer({ pools }: { pools: ExplorerPool[] }) {
  const [query, setQuery] = useState("");
  const [protocol, setProtocol] = useState<Protocol>("all");
  const [quote, setQuote] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [minTvl, setMinTvl] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("volume");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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
    const volumeFloor = toNumber(minVolume);

    const filtered = pools.filter((pool) => {
      if (protocol !== "all" && (pool.pool_type || "dlmm") !== protocol)
        return false;
      if (quote !== "all" && pool.token_y?.symbol !== quote) return false;
      if (
        verifiedOnly &&
        !(pool.token_x?.is_verified && pool.token_y?.is_verified)
      )
        return false;
      if (tvlFloor > 0 && toNumber(pool.tvl) < tvlFloor) return false;
      if (volumeFloor > 0 && toNumber(pool.volume) < volumeFloor) return false;
      if (term) {
        const haystack = [
          pool.name,
          pool.pool_address,
          pool.token_x?.symbol,
          pool.token_y?.symbol,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });

    const direction = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort(
      (a, b) => direction * (toNumber(a[sortKey]) - toNumber(b[sortKey])),
    );
  }, [
    pools,
    query,
    protocol,
    quote,
    verifiedOnly,
    minTvl,
    minVolume,
    sortKey,
    sortDir,
  ]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function reset() {
    setQuery("");
    setProtocol("all");
    setQuote("all");
    setMinTvl("");
    setMinVolume("");
    setVerifiedOnly(false);
    setSortKey("volume");
    setSortDir("desc");
  }

  const isDirty =
    query ||
    protocol !== "all" ||
    quote !== "all" ||
    minTvl ||
    minVolume ||
    verifiedOnly;

  return (
    <main className="mx-auto flex w-full max-w-[var(--page-max)] flex-1 flex-col gap-6 px-[var(--page-gutter)] py-8">
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="border-rule bg-paper-2 inline-flex h-12 w-12 items-center justify-center rounded-xl border"
          >
            <Droplets className="text-accent h-5 w-5" />
          </span>
          <h1 className="text-ink text-[28px] font-semibold tracking-tight sm:text-[32px]">
            Pool explorer
          </h1>
        </div>
        <p className="text-muted text-[15px]">
          Track and compare Meteora liquidity pools on Solana. Click a pool to
          see who is providing liquidity and how each wallet is doing.
        </p>
      </section>

      <section className="border-rule bg-paper-2 rounded-xl border">
        <div className="border-rule flex flex-wrap items-center gap-3 border-b px-4 py-4">
          <label className="border-rule bg-paper focus-within:border-rule-2 flex h-10 w-full items-center gap-2 rounded-lg border px-3 transition-colors sm:w-80">
            <Search className="text-muted h-4 w-4 shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by address or symbol"
              className="text-ink placeholder:text-muted h-full w-full bg-transparent text-sm outline-none"
            />
          </label>

          <span className="relative">
            <select
              value={protocol}
              onChange={(event) => setProtocol(event.target.value as Protocol)}
              aria-label="Protocol"
              className={selectClass}
            >
              <option value="all">All protocols</option>
              <option value="dlmm">DLMM</option>
              <option value="damm_v2">DAMM v2</option>
            </select>
            <ChevronDown className="text-muted pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2" />
          </span>

          <span className="relative">
            <select
              value={quote}
              onChange={(event) => setQuote(event.target.value)}
              aria-label="Quote token"
              className={selectClass}
            >
              <option value="all">All quotes</option>
              {quotes.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
            <ChevronDown className="text-muted pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2" />
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={!isDirty}
              className="text-muted hover:text-ink h-10 rounded-lg px-3 text-sm transition-colors disabled:opacity-40"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => setShowFilters((value) => !value)}
              aria-expanded={showFilters}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors",
                showFilters
                  ? "bg-accent text-accent-ink"
                  : "bg-accent-soft text-accent hover:bg-accent hover:text-accent-ink",
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="border-rule bg-paper-3/40 flex flex-wrap items-end gap-4 border-b px-4 py-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted">Min TVL (USD)</span>
              <input
                value={minTvl}
                onChange={(event) => setMinTvl(event.target.value)}
                inputMode="numeric"
                placeholder="0"
                className="border-rule bg-paper text-ink h-9 w-36 rounded-lg border px-3 font-mono text-sm outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted">Min volume 2h (USD)</span>
              <input
                value={minVolume}
                onChange={(event) => setMinVolume(event.target.value)}
                inputMode="numeric"
                placeholder="0"
                className="border-rule bg-paper text-ink h-9 w-36 rounded-lg border px-3 font-mono text-sm outline-none"
              />
            </label>
            <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={verifiedOnly}
                onChange={(event) => setVerifiedOnly(event.target.checked)}
                className="accent-accent h-4 w-4"
              />
              Verified tokens only
            </label>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="text-muted text-[13px]">
                <th className="px-4 pt-4 pb-3 text-left font-normal">Pool</th>
                <th className="px-4 pt-4 pb-3 text-left font-normal">
                  Protocol
                </th>
                <th className="px-4 pt-4 pb-3 text-right font-normal">
                  <SortHeader
                    label="Fee / TVL"
                    active={sortKey === "fee_active_tvl_ratio"}
                    direction={sortDir}
                    onClick={() => toggleSort("fee_active_tvl_ratio")}
                  />
                </th>
                <th className="px-4 pt-4 pb-3 text-right font-normal">
                  <SortHeader
                    label="Volume 2h"
                    active={sortKey === "volume"}
                    direction={sortDir}
                    onClick={() => toggleSort("volume")}
                  />
                </th>
                <th className="px-4 pt-4 pb-3 text-right font-normal">
                  <SortHeader
                    label="TVL"
                    active={sortKey === "tvl"}
                    direction={sortDir}
                    onClick={() => toggleSort("tvl")}
                  />
                </th>
                <th className="px-4 pt-4 pb-3 text-right font-normal">Tags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((pool, index) => {
                const href = pool.pool_address
                  ? `/pool/${pool.pool_address}?protocol=${pool.pool_type || "dlmm"}`
                  : null;
                const tags = tagsFor(pool);
                return (
                  <tr
                    key={`${pool.pool_address || pool.name || "pool"}-${index}`}
                    className="hover:bg-paper-3/60 group transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      {href ? (
                        <Link href={href} className="flex items-center gap-3">
                          <span className="flex shrink-0 -space-x-2">
                            <TokenIcon token={pool.token_x} />
                            <TokenIcon token={pool.token_y} />
                          </span>
                          <span className="text-ink group-hover:text-accent font-medium transition-colors">
                            {pool.name || "-"}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-ink font-medium">
                          {pool.name || "-"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-ink-2 inline-flex items-center gap-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="/logos/protocols/meteora.svg"
                          alt=""
                          width={28}
                          height={28}
                          className="h-7 w-7 rounded-full"
                        />
                        {protocolLabel(pool.pool_type)}
                      </span>
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {toNumber(pool.fee_active_tvl_ratio).toFixed(2)}%
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {usdCompact.format(toNumber(pool.volume))}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {usdCompact.format(toNumber(pool.tvl))}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex justify-end gap-1.5">
                        {tags.map((tag) => (
                          <span
                            key={tag.label}
                            className={cn(
                              "pill",
                              tag.tone === "ok" && "pill-ok",
                              tag.tone === "accent" && "pill-accent",
                              tag.tone === "warn" && "pill-warn",
                              tag.tone === "danger" && "pill-danger",
                            )}
                          >
                            {tag.label}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-muted px-4 py-12 text-center">
                    {pools.length === 0
                      ? "No pool data. Check data/met_pools_2h_top.json."
                      : "No pools match these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-muted border-rule border-t px-4 py-3 text-xs">
          {rows.length} of {pools.length} pools · snapshot from Meteora, 2h
          timeframe
        </p>
      </section>
    </main>
  );
}
