"use client";

import { ExternalLink, LoaderCircle, RefreshCw, Trophy } from "lucide-react";
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
import { FollowButton, PerpFlags, SideBadge } from "@/components/predict-ui";
import { perpWatchlist } from "@/lib/local-list";
import { cn } from "@/lib/utils";

interface InstrumentStat {
  instrumentId: number;
  symbol: string;
  category: string;
  trades: number;
  wins: number;
  pnlUsd: number;
}

interface OpenPosition {
  symbol: string;
  side: "long" | "short";
  notionalUsd: number;
  unrealizedPnlUsd: number;
}

interface Trader {
  address: string;
  score: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnlUsd: number;
  profitFactor: number | null;
  fills: number;
  avgFillNotionalUsd: number;
  longShare: number;
  liquidations: number;
  instruments: InstrumentStat[];
  days: number;
  positiveDays: number;
  pnl30dUsd: number;
  maxDrawdownUsd: number;
  equityUsd: number;
  openPositions: OpenPosition[];
  openNotionalUsd: number;
  unrealizedPnlUsd: number;
  lastFillAt: string | null;
  flags: string[];
  leaderboard: {
    pnlMonth: number | null;
    roiMonth: number | null;
    rankMonth: number | null;
    rankWeek: number | null;
  };
  bigWins: Array<{
    symbol: string;
    side: "long" | "short";
    pnlUsd: number;
    at: string;
  }>;
}

interface Win {
  rank: number;
  account: string;
  symbol: string;
  side: "long" | "short";
  pnlUsd: number;
  timestamp: number;
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
    profitable30d: number;
    avgWinRate: number;
    closedTrades: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  traders: Trader[];
  wins: Win[];
  warnings: string[];
  building?: boolean;
  message?: string;
}

type SortKey =
  | "score"
  | "winRate"
  | "pnl30dUsd"
  | "realizedPnlUsd"
  | "profitFactor"
  | "closedTrades"
  | "positiveDays"
  | "maxDrawdownUsd"
  | "equityUsd"
  | "openNotionalUsd"
  | "avgFillNotionalUsd"
  | "lastFillAt";

const CATEGORIES = ["", "crypto", "equity", "index", "commodity"];

export function SmartPerpBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [minTrades, setMinTrades] = useState(20);
  const [minWin, setMinWin] = useState(0.5);
  const [maxFill, setMaxFill] = useState(0);
  const [category, setCategory] = useState("");
  const [hideInactive, setHideInactive] = useState(true);
  const [hideLiquidated, setHideLiquidated] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [tab, setTab] = useState<"all" | "following">("all");
  const following = perpWatchlist.useList();

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: sortKey,
      dir: sortDir,
      minTrades: String(minTrades),
      minWin: String(minWin),
      maxFill: String(maxFill),
      hideInactive: hideInactive ? "1" : "0",
      hideLiquidated: hideLiquidated ? "1" : "0",
    });
    if (category) params.set("category", category);
    if (q.trim()) params.set("q", q.trim().toLowerCase());
    return params.toString();
  }, [
    page,
    pageSize,
    sortKey,
    sortDir,
    minTrades,
    minWin,
    maxFill,
    hideInactive,
    hideLiquidated,
    category,
    q,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/leaderboard/smart-perp?${query}`);
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
      setSortDir(key === "maxDrawdownUsd" ? "asc" : "desc");
    }
    setPage(1);
  }
  function setFilter<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }
  const changeMinTrades = setFilter(setMinTrades);
  const changeMinWin = setFilter(setMinWin);
  const changeMaxFill = setFilter(setMaxFill);
  const changeCategory = setFilter(setCategory);
  const changeHideInactive = setFilter(setHideInactive);
  const changeHideLiquidated = setFilter(setHideLiquidated);
  const changeQ = setFilter(setQ);

  return (
    <main className="mx-auto flex w-full max-w-[var(--page-max)] flex-1 flex-col gap-5 px-[var(--page-gutter)] py-8">
      <PredictTabs active="perp" />
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-ink text-[28px] font-semibold tracking-tight sm:text-[32px]">
            Perp traders
          </h1>
          <p className="text-muted max-w-2xl text-[15px]">
            Polymarket Perps accounts ranked from their own fills: win rate on
            realized trades, 30-day PnL, profit factor, share of positive days
            and drawdown. Candidates come from the perps leaderboards and the
            biggest-wins board; liquidations, one-hit profits and whales are
            flagged.
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
          label="Accounts analysed"
          value={board ? board.stats.analysed.toLocaleString() : "–"}
          hint={board ? `${board.stats.candidates} candidates` : undefined}
        />
        <Kpi
          label="Ranked"
          value={totals ? totals.ranked.toLocaleString() : "–"}
          hint="≥ 5 realized trades"
        />
        <Kpi
          label="Realized trades"
          value={totals ? totals.closedTrades.toLocaleString() : "–"}
          hint="in sampled fills"
        />
        <Kpi
          label="Avg win rate"
          value={totals ? `${Math.round(totals.avgWinRate * 100)}%` : "–"}
        />
        <Kpi
          label="Up over 30d"
          value={
            totals
              ? `${Math.round((totals.profitable30d / Math.max(1, totals.ranked)) * 100)}%`
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

      {board && board.wins.length > 0 && (
        <section className="border-rule bg-paper-2 rounded-xl border">
          <div className="border-rule flex items-center gap-2 border-b px-4 py-2.5">
            <Trophy className="text-accent h-4 w-4" />
            <h2 className="text-ink text-sm font-semibold">
              Biggest wins this month
            </h2>
            <span className="text-muted text-xs">
              single trades, from Polymarket&apos;s wins board
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto px-4 py-3">
            {board.wins.slice(0, 12).map((win) => (
              <Link
                key={`${win.account}-${win.rank}`}
                href={`/predict/perp/${win.account.toLowerCase()}`}
                className="border-rule hover:border-rule-2 flex min-w-[11rem] shrink-0 flex-col gap-1 rounded-lg border px-3 py-2 transition-colors"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-ink text-sm font-medium">
                    {win.symbol}
                  </span>
                  <SideBadge side={win.side} />
                </span>
                <span className="data text-[15px] font-semibold text-[#4ade80]">
                  {formatUsd(win.pnlUsd)}
                </span>
                <span className="data text-muted text-[11px]">
                  {shortAddress(win.account)} ·{" "}
                  {relative(new Date(win.timestamp).toISOString())}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

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
                  ? "All accounts"
                  : `Following (${following.length})`}
              </button>
            ))}
          </div>
          <input
            value={q}
            onChange={(e) => changeQ(e.target.value)}
            placeholder="Address"
            className="border-rule bg-paper text-ink placeholder:text-muted h-9 w-40 rounded-lg border px-3 text-sm outline-none"
          />
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            Market
            <select
              value={category}
              onChange={(e) => changeCategory(e.target.value)}
              className="border-rule bg-paper text-ink h-8 rounded-lg border px-2 text-sm outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c || "any"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            Min trades
            <select
              value={minTrades}
              onChange={(e) => changeMinTrades(Number(e.target.value))}
              className="border-rule bg-paper text-ink h-8 rounded-lg border px-2 text-sm outline-none"
            >
              {[5, 20, 50, 100].map((n) => (
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
              {[0, 0.5, 0.55, 0.6, 0.7].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "any" : `${Math.round(n * 100)}%`}
                </option>
              ))}
            </select>
          </label>
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            Max fill
            <select
              value={maxFill}
              onChange={(e) => changeMaxFill(Number(e.target.value))}
              className="border-rule bg-paper text-ink h-8 rounded-lg border px-2 text-sm outline-none"
            >
              {[0, 500, 2000, 10000, 50000].map((n) => (
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
              checked={hideLiquidated}
              onChange={(e) => changeHideLiquidated(e.target.checked)}
              className="accent-accent h-4 w-4"
            />
            Never liquidated
          </label>
          <span className="text-muted ml-auto text-xs">
            {totals ? `${totals.matching.toLocaleString()} accounts` : ""}
            {loading && board && " · updating…"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1350px] text-sm">
            <thead className="bg-paper-3/50">
              <tr>
                <th className="text-muted w-12 px-4 py-2.5 text-left text-xs font-medium uppercase">
                  #
                </th>
                <Th
                  label="Account"
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
                  title="Realized fills in profit / realized fills (sample)"
                />
                <Th
                  label="PnL 30d"
                  sortKey="pnl30dUsd"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Sum of daily PnL over the last 30 days"
                />
                <Th
                  label="PF"
                  sortKey="profitFactor"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Gross wins / gross losses in the sample"
                />
                <Th
                  label="Days +"
                  sortKey="positiveDays"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Positive days / days with activity (30d)"
                />
                <Th
                  label="Drawdown"
                  sortKey="maxDrawdownUsd"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Largest peak-to-trough on the 30-day PnL curve"
                />
                <Th
                  label="Equity"
                  sortKey="equityUsd"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Avg fill"
                  sortKey="avgFillNotionalUsd"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Average fill notional"
                />
                <Th
                  label="Open"
                  sortKey="openNotionalUsd"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Open positions · notional"
                />
                <Th
                  label="Markets"
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
                  label="Last fill"
                  sortKey="lastFillAt"
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
                      ? "You are not following any account on this page yet."
                      : "No account matches these filters."}
                  </td>
                </tr>
              )}
              {rows.map((t, index) => (
                <tr
                  key={t.address}
                  className="hover:bg-paper-3/40 transition-colors"
                >
                  <td className="data text-muted px-4 py-3">
                    {(board!.pagination.page - 1) * board!.pagination.pageSize +
                      index +
                      1}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/predict/perp/${t.address}`}
                      className="data text-accent hover:text-focus underline decoration-dotted underline-offset-4"
                      title={t.address}
                    >
                      {shortAddress(t.address)}
                    </Link>
                    {t.leaderboard.rankMonth && (
                      <span className="text-muted ml-2 text-[11px]">
                        #{t.leaderboard.rankMonth} month
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ScoreBadge score={t.score} />
                  </td>
                  <td
                    className={cn(
                      "data px-4 py-3 text-right font-medium",
                      t.winRate >= 0.55
                        ? "text-[#4ade80]"
                        : t.winRate < 0.5
                          ? "text-[#fb7185]"
                          : "text-ink",
                    )}
                  >
                    {(t.winRate * 100).toFixed(0)}%
                    <span className="text-muted">
                      {" "}
                      · {t.wins}/{t.closedTrades}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "data px-4 py-3 text-right font-medium",
                      tone(t.pnl30dUsd),
                    )}
                  >
                    {formatUsd(t.pnl30dUsd)}
                  </td>
                  <td className="data text-ink px-4 py-3 text-right">
                    {t.profitFactor == null ? "∞" : t.profitFactor.toFixed(2)}
                  </td>
                  <td className="data text-ink px-4 py-3 text-right">
                    {t.positiveDays}
                    <span className="text-muted">/{t.days}</span>
                  </td>
                  <td className="data px-4 py-3 text-right text-[#fb7185]">
                    {t.maxDrawdownUsd > 0
                      ? `-${formatUsd(t.maxDrawdownUsd)}`
                      : "–"}
                  </td>
                  <td className="data text-ink px-4 py-3 text-right">
                    {formatUsd(t.equityUsd)}
                  </td>
                  <td className="data text-ink px-4 py-3 text-right">
                    {formatUsd(t.avgFillNotionalUsd)}
                  </td>
                  <td className="data text-ink px-4 py-3 text-right">
                    {t.openPositions.length}
                    <span className="text-muted">
                      {" "}
                      · {formatUsd(t.openNotionalUsd)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex max-w-[16rem] flex-wrap gap-1">
                      {t.instruments.slice(0, 3).map((i) => (
                        <span
                          key={i.instrumentId}
                          className={cn(
                            "inline-flex h-5 items-center rounded px-1.5 text-[10px]",
                            i.pnlUsd >= 0
                              ? "bg-[#22c55e]/10 text-[#4ade80]"
                              : "bg-[#f43f5e]/10 text-[#fb7185]",
                          )}
                          title={`${i.trades} trades · ${Math.round((i.wins / Math.max(1, i.trades)) * 100)}% win · ${formatUsd(i.pnlUsd)}`}
                        >
                          {i.symbol.replace("-USD", "")}
                        </span>
                      ))}
                      {t.instruments.length > 3 && (
                        <span className="text-muted text-[10px]">
                          +{t.instruments.length - 3}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <PerpFlags flags={t.flags} />
                  </td>
                  <td className="data text-ink-2 px-4 py-3 text-right whitespace-nowrap">
                    {relative(t.lastFillAt)}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <FollowButton address={t.address} list={perpWatchlist} />
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
        {board && (
          <div className="text-muted border-rule flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-xs">
            <span>
              Score = 30% win rate (sample-weighted) + 25% 30-day PnL + 15%
              profit factor + 15% positive days + 15% drawdown control, minus
              liquidation, one-hit, inactive, whale and leverage penalties. Win
              rate and PF come from the latest fills with realized PnL (up to
              300); PnL and drawdown from the daily series.
            </span>
            <a
              href="https://polymarket.com/perps"
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink inline-flex items-center gap-1"
            >
              Polymarket Perps <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
