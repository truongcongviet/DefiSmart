"use client";

import { LoaderCircle, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  formatUsd,
  Kpi,
  Pagination,
  relative,
  ScoreBadge,
  shortAddress,
  Th,
  tone,
} from "@/components/board-ui";
import { PredictTabs } from "@/components/predict-tabs";
import {
  Avatar,
  CATEGORY_LABEL,
  CategoryChips,
  FlagIcons,
  FollowButton,
  MethodNote,
  RateBar,
} from "@/components/predict-ui";
import { predictWatchlist } from "@/lib/local-list";
import { cn } from "@/lib/utils";

interface CategoryStat {
  category: string;
  markets: number;
  wins: number;
  pnlUsd: number;
}

interface Trader {
  address: string;
  name: string;
  verified: boolean;
  profileImage: string | null;
  score: number;
  markets: number;
  wins: number;
  losses: number;
  markets30d: number;
  winRate30d: number | null;
  winRate: number;
  realizedPnlUsd: number;
  roi: number;
  profitFactor: number | null;
  avgStakeUsd: number;
  medianStakeUsd: number;
  categories: CategoryStat[];
  openPositions: number;
  openExposureUsd: number;
  lastTradeAt: string | null;
  flags: string[];
}

interface Board {
  generatedAt: string;
  stats: { candidates: number; analysed: number; ranked: number };
  totals: {
    ranked: number;
    matching: number;
    profitable: number;
    avgWinRate: number;
    markets: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  traders: Trader[];
  building?: boolean;
  message?: string;
}

type SortKey =
  | "score"
  | "winRate"
  | "winRate30d"
  | "realizedPnlUsd"
  | "roi"
  | "markets"
  | "avgStakeUsd"
  | "lastTradeAt";

const CATEGORIES = ["", "sports", "politics", "crypto", "finance", "culture"];
const WIN_PRESETS = [0, 0.55, 0.6, 0.7];

export function SmartPredictBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [minMarkets, setMinMarkets] = useState(20);
  const [minWin, setMinWin] = useState(0.55);
  const [category, setCategory] = useState("");
  const [hideInactive, setHideInactive] = useState(true);
  const [hideWhales, setHideWhales] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [tab, setTab] = useState<"all" | "following">("all");
  const following = predictWatchlist.useList();

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: sortKey,
      dir: sortDir,
      minMarkets: String(minMarkets),
      minWin: String(minWin),
      hideInactive: hideInactive ? "1" : "0",
      hideWhales: hideWhales ? "1" : "0",
    });
    if (category) params.set("category", category);
    if (q.trim()) params.set("q", q.trim());
    return params.toString();
  }, [
    page,
    pageSize,
    sortKey,
    sortDir,
    minMarkets,
    minWin,
    hideInactive,
    hideWhales,
    category,
    q,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/leaderboard/smart-predict?${query}`);
      const payload = (await response.json()) as Board;
      if (!response.ok)
        throw new Error(payload.message || `HTTP ${response.status}`);
      setBoard(payload);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load leaderboard",
      );
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const list = board?.traders ?? [];
    return tab === "following"
      ? list.filter((t) => following.includes(t.address))
      : list;
  }, [board, tab, following]);
  const totals = board?.totals ?? null;

  function onSort(key: SortKey) {
    if (key === sortKey) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  }
  function setFilter<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }
  const changeMinMarkets = setFilter(setMinMarkets);
  const changeMinWin = setFilter(setMinWin);
  const changeCategory = setFilter(setCategory);
  const changeHideInactive = setFilter(setHideInactive);
  const changeHideWhales = setFilter(setHideWhales);
  const changeQ = setFilter(setQ);

  const select =
    "border-rule bg-paper text-ink h-8 rounded-lg border px-2 text-sm outline-none";
  const toggle = (on: boolean) =>
    cn(
      "inline-flex h-8 items-center rounded-lg border px-2.5 text-xs transition-colors",
      on
        ? "border-accent bg-accent-soft text-accent"
        : "border-rule text-ink-2 hover:text-ink",
    );

  return (
    <main className="mx-auto flex w-full max-w-[var(--page-max)] flex-1 flex-col gap-4 px-[var(--page-gutter)] py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PredictTabs active="prediction" />
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="border-rule text-ink-2 hover:border-rule-2 hover:text-ink inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors disabled:opacity-50"
        >
          {loading ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Reload
        </button>
      </div>

      <section className="flex flex-col gap-1">
        <h1 className="text-ink text-[26px] font-semibold tracking-tight">
          Prediction-market traders
        </h1>
        <p className="text-muted text-sm">
          Polymarket wallets ranked by what they settled. Follow one and copy
          its open positions from the profile.
        </p>
      </section>

      <section className="border-rule bg-paper-2 divide-rule grid grid-cols-2 divide-x divide-y rounded-xl border sm:grid-cols-4 sm:divide-y-0">
        <Kpi
          label="Ranked traders"
          value={totals ? totals.ranked.toLocaleString() : "–"}
          hint={board ? `of ${board.stats.analysed} analysed` : undefined}
        />
        <Kpi
          label="Avg win rate"
          value={totals ? `${Math.round(totals.avgWinRate * 100)}%` : "–"}
        />
        <Kpi
          label="In profit"
          value={
            totals
              ? `${Math.round((totals.profitable / Math.max(1, totals.ranked)) * 100)}%`
              : "–"
          }
        />
        <Kpi
          label="Updated"
          value={board ? relative(board.generatedAt) : "–"}
          hint={board?.building ? "rescanning…" : undefined}
        />
      </section>

      <section className="border-rule bg-paper-2 rounded-xl border">
        <div className="border-rule flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <div className="bg-paper-3 inline-flex h-8 items-center rounded-lg p-0.5">
            {(["all", "following"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={cn(
                  "h-7 rounded-md px-3 text-xs transition-colors",
                  tab === item
                    ? "bg-paper text-ink shadow-sm"
                    : "text-muted hover:text-ink",
                )}
              >
                {item === "all" ? "All" : `Following ${following.length}`}
              </button>
            ))}
          </div>
          <label className="border-rule bg-paper text-ink inline-flex h-8 items-center gap-1.5 rounded-lg border px-2">
            <Search className="text-muted h-3.5 w-3.5" />
            <input
              value={q}
              onChange={(e) => changeQ(e.target.value)}
              placeholder="Name or address"
              className="placeholder:text-muted w-36 bg-transparent text-sm outline-none"
            />
          </label>
          <select
            value={category}
            onChange={(e) => changeCategory(e.target.value)}
            className={select}
            aria-label="Category"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c ? CATEGORY_LABEL[c] : "All categories"}
              </option>
            ))}
          </select>
          <div className="inline-flex items-center gap-1">
            {WIN_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => changeMinWin(n)}
                className={toggle(minWin === n)}
              >
                {n === 0 ? "Any win" : `≥ ${Math.round(n * 100)}%`}
              </button>
            ))}
          </div>
          <select
            value={minMarkets}
            onChange={(e) => changeMinMarkets(Number(e.target.value))}
            className={select}
            aria-label="Minimum markets"
          >
            {[5, 10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                ≥ {n} markets
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => changeHideInactive(!hideInactive)}
            className={toggle(hideInactive)}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => changeHideWhales(!hideWhales)}
            className={toggle(hideWhales)}
          >
            No whales
          </button>
          <span className="text-muted ml-auto text-xs">
            {totals ? `${totals.matching.toLocaleString()} traders` : ""}
            {loading && board && " · updating…"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-paper-3/50">
              <tr>
                <th className="text-muted w-10 px-3 py-2 text-left text-xs font-medium uppercase">
                  #
                </th>
                <Th
                  label="Trader"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  align="left"
                />
                <Th
                  label="Score"
                  sortKey="score"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Win rate"
                  sortKey="winRate"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Markets settled in profit / settled"
                />
                <Th
                  label="30d"
                  sortKey="winRate30d"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Win rate on markets settled in the last 30 days"
                />
                <Th
                  label="PnL"
                  sortKey="realizedPnlUsd"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Realized PnL"
                />
                <Th
                  label="ROI"
                  sortKey="roi"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Markets"
                  sortKey="markets"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Stake"
                  sortKey="avgStakeUsd"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Average stake per market"
                />
                <Th
                  label="Focus"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  align="left"
                />
                <Th
                  label="Last"
                  sortKey="lastTradeAt"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <th className="w-12 px-2 py-2" aria-label="Follow" />
              </tr>
            </thead>
            <tbody className="divide-rule divide-y">
              {loading &&
                !board &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={12} className="px-3 py-3">
                      <div className="bg-paper-3 h-4 animate-pulse rounded" />
                    </td>
                  </tr>
                ))}
              {error && (
                <tr>
                  <td
                    colSpan={12}
                    className="px-3 py-10 text-center text-sm text-[#fb7185]"
                  >
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={12}
                    className="text-muted px-3 py-10 text-center"
                  >
                    {tab === "following"
                      ? "No followed trader on this page."
                      : "No trader matches these filters."}
                  </td>
                </tr>
              )}
              {rows.map((trader, index) => (
                <tr
                  key={trader.address}
                  className="hover:bg-paper-3/40 transition-colors"
                >
                  <td className="data text-muted px-3 py-2.5">
                    {(board!.pagination.page - 1) * board!.pagination.pageSize +
                      index +
                      1}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <Link
                        href={`/predict/${trader.address}`}
                        className="flex items-center gap-2.5"
                        title={trader.address}
                      >
                        <Avatar
                          src={trader.profileImage}
                          name={trader.name}
                          size={8}
                        />
                        <span className="flex min-w-0 flex-col leading-tight">
                          <span className="text-ink hover:text-accent truncate text-sm font-medium">
                            {trader.name}
                            {trader.verified && (
                              <span className="text-accent ml-1 text-[10px]">
                                ✓
                              </span>
                            )}
                          </span>
                          <span className="data text-muted text-[11px]">
                            {shortAddress(trader.address)}
                          </span>
                        </span>
                      </Link>
                      <FlagIcons flags={trader.flags} kind="predict" />
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <ScoreBadge score={trader.score} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <RateBar
                      value={trader.winRate}
                      hint={`${trader.wins} won · ${trader.losses} lost`}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <RateBar
                      value={trader.winRate30d}
                      hint={`${trader.markets30d} markets in 30 days`}
                    />
                  </td>
                  <td
                    className={cn(
                      "data px-3 py-2.5 text-right font-medium",
                      tone(trader.realizedPnlUsd),
                    )}
                  >
                    {formatUsd(trader.realizedPnlUsd)}
                  </td>
                  <td
                    className={cn(
                      "data px-3 py-2.5 text-right",
                      tone(trader.roi),
                    )}
                  >
                    {(trader.roi * 100).toFixed(0)}%
                  </td>
                  <td className="data text-ink px-3 py-2.5 text-right">
                    {trader.markets}
                  </td>
                  <td className="data text-ink px-3 py-2.5 text-right">
                    {formatUsd(trader.avgStakeUsd)}
                  </td>
                  <td className="px-3 py-2.5">
                    <CategoryChips
                      categories={trader.categories}
                      total={trader.markets}
                    />
                  </td>
                  <td className="data text-ink-2 px-3 py-2.5 text-right whitespace-nowrap">
                    {relative(trader.lastTradeAt)}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <FollowButton address={trader.address} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {board && tab === "all" && (
          <Pagination
            page={board.pagination.page}
            pageSize={board.pagination.pageSize}
            total={board.pagination.total}
            totalPages={board.pagination.totalPages}
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            disabled={loading}
          />
        )}
        <MethodNote>
          Candidates come from Polymarket&apos;s PnL and volume leaderboards.
          Every wallet is re-scored from its own settled positions, netted per
          market so hedged legs count once. Score = 35% win rate (weighted by
          sample) + 25% PnL + 15% ROI + 15% profit factor + 10% profit spread,
          minus one-hit, inactive, whale and favorites-only penalties. Icons: 🐋
          whale, 🎯 one-hit profit, 🏟️ sports only, 💤 inactive, 🔬 small
          sample, 🪙 favorites only.
        </MethodNote>
      </section>
    </main>
  );
}
