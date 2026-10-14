"use client";

import { ExternalLink, LoaderCircle, RefreshCw, Target } from "lucide-react";
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
import {
  Avatar,
  CATEGORY_LABEL,
  FollowButton,
  PredictFlags,
} from "@/components/predict-ui";
import { PredictTabs } from "@/components/predict-tabs";
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
  topWinShare: number;
  categories: CategoryStat[];
  openPositions: number;
  openExposureUsd: number;
  unrealizedPnlUsd: number;
  lastTradeAt: string | null;
  flags: string[];
  leaderboard: {
    pnl30d: number | null;
    vol30d: number | null;
    pnl7d: number | null;
  };
}

interface Board {
  generatedAt: string;
  stats: {
    candidates: number;
    analysed: number;
    failed: number;
    ranked: number;
    durationMs: number;
  };
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
  warnings: string[];
  building?: boolean;
  message?: string;
}

type SortKey =
  | "score"
  | "winRate"
  | "winRate30d"
  | "realizedPnlUsd"
  | "roi"
  | "profitFactor"
  | "markets"
  | "avgStakeUsd"
  | "openExposureUsd"
  | "lastTradeAt";

const CATEGORIES = ["", "sports", "politics", "crypto", "finance", "culture"];

export function SmartPredictBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [minMarkets, setMinMarkets] = useState(20);
  const [minWin, setMinWin] = useState(0.55);
  const [maxStake, setMaxStake] = useState(0);
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
      maxStake: String(maxStake),
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
    maxStake,
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
  const changeMaxStake = setFilter(setMaxStake);
  const changeCategory = setFilter(setCategory);
  const changeHideInactive = setFilter(setHideInactive);
  const changeHideWhales = setFilter(setHideWhales);
  const changeQ = setFilter(setQ);

  return (
    <main className="mx-auto flex w-full max-w-[var(--page-max)] flex-1 flex-col gap-5 px-[var(--page-gutter)] py-8">
      <PredictTabs active="prediction" />
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className="border-rule bg-paper-2 inline-flex h-12 w-12 items-center justify-center rounded-xl border"
            >
              <Target className="text-accent h-5 w-5" />
            </span>
            <h1 className="text-ink text-[28px] font-semibold tracking-tight sm:text-[32px]">
              PredictSmart
            </h1>
          </div>
          <p className="text-muted max-w-2xl text-[15px]">
            Polymarket traders ranked by what they actually settled: win rate
            per market, ROI, profit factor and how spread out the profit is.
            Candidates come from Polymarket&apos;s PnL and volume leaderboards;
            every number is recomputed from their positions. Follow a trader and
            copy their open positions from the profile page.
          </p>
        </div>
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
      </section>

      <section className="border-rule bg-paper-2 divide-rule grid grid-cols-2 divide-x divide-y rounded-xl border sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        <Kpi
          label="Traders analysed"
          value={board ? board.stats.analysed.toLocaleString() : "–"}
          hint={board ? `${board.stats.candidates} candidates` : undefined}
        />
        <Kpi
          label="Ranked"
          value={totals ? totals.ranked.toLocaleString() : "–"}
          hint="≥ 5 settled markets"
        />
        <Kpi
          label="Settled markets"
          value={totals ? totals.markets.toLocaleString() : "–"}
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
          hint={
            board?.building
              ? "rescanning…"
              : board
                ? new Date(board.generatedAt).toLocaleString()
                : undefined
          }
        />
      </section>

      <section className="border-rule bg-paper-2 rounded-xl border">
        <div className="border-rule flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="bg-paper-3 inline-flex h-9 items-center rounded-lg p-0.5">
            {(["all", "following"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={cn(
                  "h-8 rounded-md px-3 text-sm transition-colors",
                  tab === item
                    ? "bg-paper text-ink shadow-sm"
                    : "text-muted hover:text-ink",
                )}
              >
                {item === "all"
                  ? "All traders"
                  : `Following (${following.length})`}
              </button>
            ))}
          </div>
          <input
            value={q}
            onChange={(e) => changeQ(e.target.value)}
            placeholder="Name or address"
            className="border-rule bg-paper text-ink placeholder:text-muted h-9 w-44 rounded-lg border px-3 text-sm outline-none"
          />
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            Category
            <select
              value={category}
              onChange={(e) => changeCategory(e.target.value)}
              className="border-rule bg-paper text-ink h-8 rounded-lg border px-2 text-sm outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c ? CATEGORY_LABEL[c] : "any"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            Min markets
            <select
              value={minMarkets}
              onChange={(e) => changeMinMarkets(Number(e.target.value))}
              className="border-rule bg-paper text-ink h-8 rounded-lg border px-2 text-sm outline-none"
            >
              {[5, 10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            Min win rate
            <select
              value={minWin}
              onChange={(e) => changeMinWin(Number(e.target.value))}
              className="border-rule bg-paper text-ink h-8 rounded-lg border px-2 text-sm outline-none"
            >
              {[0, 0.5, 0.55, 0.6, 0.7, 0.8].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "any" : `${Math.round(n * 100)}%`}
                </option>
              ))}
            </select>
          </label>
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            Max stake
            <select
              value={maxStake}
              onChange={(e) => changeMaxStake(Number(e.target.value))}
              className="border-rule bg-paper text-ink h-8 rounded-lg border px-2 text-sm outline-none"
            >
              {[0, 100, 500, 2000, 10000].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "any" : `≤ ${formatUsd(n)}`}
                </option>
              ))}
            </select>
          </label>
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hideInactive}
              onChange={(e) => changeHideInactive(e.target.checked)}
              className="accent-accent h-4 w-4"
            />
            Active only
          </label>
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hideWhales}
              onChange={(e) => changeHideWhales(e.target.checked)}
              className="accent-accent h-4 w-4"
            />
            Hide whales
          </label>
          <span className="text-muted ml-auto text-xs">
            {totals ? `${totals.matching.toLocaleString()} traders` : ""}
            {loading && board && " · updating…"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1300px] text-sm">
            <thead className="bg-paper-3/50">
              <tr>
                <th className="text-muted w-12 px-4 py-2.5 text-left text-xs font-medium uppercase">
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
                  title="Markets settled in profit / markets settled"
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
                  label="Realized PnL"
                  sortKey="realizedPnlUsd"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="ROI"
                  sortKey="roi"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Realized PnL / total stake"
                />
                <Th
                  label="PF"
                  sortKey="profitFactor"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Profit factor: gross wins / gross losses"
                />
                <Th
                  label="Markets"
                  sortKey="markets"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Avg stake"
                  sortKey="avgStakeUsd"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Open"
                  sortKey="openExposureUsd"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Live positions · exposure"
                />
                <Th
                  label="Focus"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  align="left"
                />
                <Th
                  label="Flags"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  align="left"
                />
                <Th
                  label="Last trade"
                  sortKey="lastTradeAt"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <th className="w-14 px-2 py-2.5" aria-label="Follow" />
              </tr>
            </thead>
            <tbody className="divide-rule divide-y">
              {loading &&
                !board &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={15} className="px-4 py-3.5">
                      <div className="bg-paper-3 h-4 animate-pulse rounded" />
                    </td>
                  </tr>
                ))}
              {error && (
                <tr>
                  <td
                    colSpan={15}
                    className="px-4 py-10 text-center text-sm text-[#fb7185]"
                  >
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={15}
                    className="text-muted px-4 py-10 text-center"
                  >
                    {tab === "following"
                      ? "You are not following any trader on this page yet."
                      : "No trader matches these filters."}
                  </td>
                </tr>
              )}
              {rows.map((trader, index) => {
                const focus = trader.categories.slice(0, 2);
                return (
                  <tr
                    key={trader.address}
                    className="hover:bg-paper-3/40 transition-colors"
                  >
                    <td className="data text-muted px-4 py-3">
                      {(board!.pagination.page - 1) *
                        board!.pagination.pageSize +
                        index +
                        1}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/predict/${trader.address}`}
                        className="flex items-center gap-2.5"
                        title={trader.address}
                      >
                        <Avatar src={trader.profileImage} name={trader.name} />
                        <span className="flex min-w-0 flex-col">
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
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ScoreBadge score={trader.score} />
                    </td>
                    <td
                      className={cn(
                        "data px-4 py-3 text-right font-medium",
                        trader.winRate >= 0.55
                          ? "text-[#4ade80]"
                          : trader.winRate < 0.5
                            ? "text-[#fb7185]"
                            : "text-ink",
                      )}
                    >
                      {(trader.winRate * 100).toFixed(0)}%
                      <span className="text-muted">
                        {" "}
                        · {trader.wins}/{trader.markets}
                      </span>
                    </td>
                    <td className="data text-ink px-4 py-3 text-right">
                      {trader.winRate30d == null
                        ? "–"
                        : `${(trader.winRate30d * 100).toFixed(0)}%`}
                      {trader.markets30d > 0 && (
                        <span className="text-muted">
                          {" "}
                          · {trader.markets30d}
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "data px-4 py-3 text-right font-medium",
                        tone(trader.realizedPnlUsd),
                      )}
                    >
                      {formatUsd(trader.realizedPnlUsd)}
                    </td>
                    <td
                      className={cn(
                        "data px-4 py-3 text-right",
                        tone(trader.roi),
                      )}
                    >
                      {(trader.roi * 100).toFixed(0)}%
                    </td>
                    <td className="data text-ink px-4 py-3 text-right">
                      {trader.profitFactor == null
                        ? "∞"
                        : trader.profitFactor.toFixed(2)}
                    </td>
                    <td className="data text-ink px-4 py-3 text-right">
                      {trader.markets}
                    </td>
                    <td className="data text-ink px-4 py-3 text-right">
                      {formatUsd(trader.avgStakeUsd)}
                    </td>
                    <td className="data text-ink px-4 py-3 text-right">
                      {trader.openPositions}
                      <span className="text-muted">
                        {" "}
                        · {formatUsd(trader.openExposureUsd)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1">
                        {focus.map((c) => (
                          <span
                            key={c.category}
                            className="bg-paper-3 text-ink-2 inline-flex h-5 items-center rounded px-1.5 text-[10px] uppercase"
                            title={`${c.markets} markets · ${Math.round((c.wins / Math.max(1, c.markets)) * 100)}% win · ${formatUsd(c.pnlUsd)}`}
                          >
                            {CATEGORY_LABEL[c.category] ?? c.category}{" "}
                            {Math.round(
                              (c.markets / Math.max(1, trader.markets)) * 100,
                            )}
                            %
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <PredictFlags flags={trader.flags} />
                    </td>
                    <td className="data text-ink-2 px-4 py-3 text-right whitespace-nowrap">
                      {relative(trader.lastTradeAt)}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <FollowButton address={trader.address} />
                    </td>
                  </tr>
                );
              })}
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
        {board && (
          <div className="text-muted border-rule flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-xs">
            <span>
              Score = 35% win rate (weighted by sample) + 25% PnL + 15% ROI +
              15% profit factor + 10% profit spread, minus one-hit, inactive,
              whale and favorites-only penalties. Wins and losses are netted per
              market, so hedged legs count once.
            </span>
            <a
              href="https://polymarket.com/leaderboard"
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink inline-flex items-center gap-1"
            >
              Polymarket leaderboard <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
