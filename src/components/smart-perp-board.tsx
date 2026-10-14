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
  DaysStrip,
  FlagIcons,
  FollowButton,
  LogoStack,
  MarketLogo,
  MethodNote,
  RateBar,
  SideBadge,
  type ThemedLogo,
} from "@/components/predict-ui";
import { perpWatchlist } from "@/lib/local-list";
import { cn } from "@/lib/utils";

interface InstrumentStat {
  instrumentId: number;
  symbol: string;
  logo: ThemedLogo | null;
  category: string;
  trades: number;
  wins: number;
  pnlUsd: number;
}

interface Trader {
  address: string;
  score: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number | null;
  avgFillNotionalUsd: number;
  instruments: InstrumentStat[];
  days: number;
  positiveDays: number;
  pnl30dUsd: number;
  maxDrawdownUsd: number;
  equityUsd: number;
  openNotionalUsd: number;
  lastFillAt: string | null;
  flags: string[];
  leaderboard: { rankMonth: number | null };
}

interface Win {
  rank: number;
  account: string;
  symbol: string;
  logo: ThemedLogo | null;
  side: "long" | "short";
  pnlUsd: number;
  timestamp: number;
}

interface Board {
  generatedAt: string;
  stats: { candidates: number; analysed: number; ranked: number };
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
  building?: boolean;
  message?: string;
}

type SortKey =
  | "score"
  | "winRate"
  | "pnl30dUsd"
  | "profitFactor"
  | "closedTrades"
  | "positiveDays"
  | "maxDrawdownUsd"
  | "equityUsd"
  | "avgFillNotionalUsd"
  | "lastFillAt";

const CATEGORIES = ["", "crypto", "equity", "index", "commodity"];
const WIN_PRESETS = [0, 0.5, 0.6, 0.7];

export function SmartPerpBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [minTrades, setMinTrades] = useState(20);
  const [minWin, setMinWin] = useState(0.5);
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
  const changeCategory = setFilter(setCategory);
  const changeHideInactive = setFilter(setHideInactive);
  const changeHideLiquidated = setFilter(setHideLiquidated);
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
        <PredictTabs active="perp" />
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
          Perp traders
        </h1>
        <p className="text-muted text-sm">
          Polymarket Perps accounts ranked from their own fills and daily PnL.
          Follow one and mirror its open positions.
        </p>
      </section>

      <section className="border-rule bg-paper-2 divide-rule grid grid-cols-2 divide-x divide-y rounded-xl border sm:grid-cols-4 sm:divide-y-0">
        <Kpi
          label="Ranked accounts"
          value={totals ? totals.ranked.toLocaleString() : "–"}
          hint={board ? `of ${board.stats.analysed} analysed` : undefined}
        />
        <Kpi
          label="Avg win rate"
          value={totals ? `${Math.round(totals.avgWinRate * 100)}%` : "–"}
        />
        <Kpi
          label="Up over 30 days"
          value={
            totals
              ? `${Math.round((totals.profitable30d / Math.max(1, totals.ranked)) * 100)}%`
              : "–"
          }
        />
        <Kpi
          label="Updated"
          value={board ? relative(board.generatedAt) : "–"}
          hint={board?.building ? "rescanning…" : undefined}
        />
      </section>

      {board && board.wins.length > 0 && (
        <section className="flex gap-2 overflow-x-auto pb-1">
          {board.wins.slice(0, 10).map((win) => (
            <Link
              key={`${win.account}-${win.rank}`}
              href={`/predict/perp/${win.account.toLowerCase()}`}
              className="border-rule bg-paper-2 hover:border-rule-2 flex min-w-[12rem] shrink-0 items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors"
              title={`Biggest win #${win.rank} this month · ${shortAddress(win.account)}`}
            >
              <MarketLogo logo={win.logo} symbol={win.symbol} size={8} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="flex items-center gap-1.5">
                  <span className="text-ink text-sm font-medium">
                    {win.symbol.replace("-USD", "")}
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
              </span>
            </Link>
          ))}
        </section>
      )}

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
              placeholder="Address"
              className="placeholder:text-muted w-32 bg-transparent text-sm outline-none"
            />
          </label>
          <select
            value={category}
            onChange={(e) => changeCategory(e.target.value)}
            className={select}
            aria-label="Market type"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c ? c[0].toUpperCase() + c.slice(1) : "All markets"}
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
            value={minTrades}
            onChange={(e) => changeMinTrades(Number(e.target.value))}
            className={select}
            aria-label="Minimum trades"
          >
            {[5, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                ≥ {n} trades
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
            onClick={() => changeHideLiquidated(!hideLiquidated)}
            className={toggle(hideLiquidated)}
          >
            Never liquidated
          </button>
          <span className="text-muted ml-auto text-xs">
            {totals ? `${totals.matching.toLocaleString()} accounts` : ""}
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
                  title="Realized fills in profit / realized fills (latest 300)"
                />
                <Th
                  label="PnL 30d"
                  sortKey="pnl30dUsd"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Days +"
                  sortKey="positiveDays"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Positive days / active days in the last 30"
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
                  label="Markets"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  align="left"
                />
                <Th
                  label="Last"
                  sortKey="lastFillAt"
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
                    <td colSpan={11} className="px-3 py-3">
                      <div className="bg-paper-3 h-4 animate-pulse rounded" />
                    </td>
                  </tr>
                ))}
              {error && (
                <tr>
                  <td
                    colSpan={11}
                    className="px-3 py-10 text-center text-sm text-[#fb7185]"
                  >
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    className="text-muted px-3 py-10 text-center"
                  >
                    {tab === "following"
                      ? "No followed account on this page."
                      : "No account matches these filters."}
                  </td>
                </tr>
              )}
              {rows.map((t, index) => (
                <tr
                  key={t.address}
                  className="hover:bg-paper-3/40 transition-colors"
                >
                  <td className="data text-muted px-3 py-2.5">
                    {(board!.pagination.page - 1) * board!.pagination.pageSize +
                      index +
                      1}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <Link
                        href={`/predict/perp/${t.address}`}
                        className="flex flex-col leading-tight"
                        title={t.address}
                      >
                        <span className="data text-ink hover:text-accent text-sm font-medium">
                          {shortAddress(t.address)}
                        </span>
                        {t.leaderboard.rankMonth && (
                          <span className="text-muted text-[11px]">
                            #{t.leaderboard.rankMonth} this month
                          </span>
                        )}
                      </Link>
                      <FlagIcons flags={t.flags} kind="perp" />
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <ScoreBadge score={t.score} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <RateBar
                      value={t.winRate}
                      hint={`${t.wins} won · ${t.losses} lost · PF ${t.profitFactor == null ? "∞" : t.profitFactor.toFixed(2)}`}
                    />
                  </td>
                  <td
                    className={cn(
                      "data px-3 py-2.5 text-right font-medium",
                      tone(t.pnl30dUsd),
                    )}
                  >
                    {formatUsd(t.pnl30dUsd)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <DaysStrip positive={t.positiveDays} total={t.days} />
                  </td>
                  <td className="data px-3 py-2.5 text-right text-[#fb7185]">
                    {t.maxDrawdownUsd > 0
                      ? `-${formatUsd(t.maxDrawdownUsd)}`
                      : "–"}
                  </td>
                  <td className="data text-ink px-3 py-2.5 text-right">
                    {formatUsd(t.equityUsd)}
                  </td>
                  <td className="px-3 py-2.5">
                    <LogoStack
                      items={t.instruments.map((i) => ({
                        key: String(i.instrumentId),
                        logo: i.logo,
                        symbol: i.symbol,
                        title: `${i.symbol.replace("-USD", "")}: ${i.trades} trades · ${Math.round((i.wins / Math.max(1, i.trades)) * 100)}% win · ${formatUsd(i.pnlUsd)}`,
                      }))}
                    />
                  </td>
                  <td className="data text-ink-2 px-3 py-2.5 text-right whitespace-nowrap">
                    {relative(t.lastFillAt)}
                  </td>
                  <td className="px-2 py-2.5 text-right">
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
        <MethodNote>
          Candidates come from the perps leaderboards and the biggest-wins
          board. Score = 30% win rate (sample-weighted) + 25% 30-day PnL + 15%
          profit factor + 15% positive days + 15% drawdown control, minus
          liquidation, one-hit, inactive, whale, leverage and new-account
          penalties. Icons: 💥 liquidated, 🎯 one-hit profit, 🐋 whale, ⚡ over
          10× leverage, ⏱️ scalper, 💤 inactive, 🔬 small sample, 🆕 new.
        </MethodNote>
      </section>
    </main>
  );
}
