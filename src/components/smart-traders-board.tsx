"use client";

import { Crosshair, LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  FlagPills,
  formatUsd,
  humanMinutes,
  Kpi,
  Pagination,
  relative,
  ScoreBadge,
  shortAddress,
  Th,
  tone,
  WatchButton,
} from "@/components/board-ui";
import { TokenMark } from "@/components/token-mark";
import { cn } from "@/lib/utils";

interface BoardTokenSummary {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  totalPnlUsd: number;
  realizedPnlUsd: number;
  closed: boolean;
}

interface BoardWallet {
  owner: string;
  score: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  costUsd: number;
  volumeUsd: number;
  roi: number;
  tokensTraded: number;
  tokensProfitable: number;
  tokensClosed: number;
  winRate: number;
  trades: number;
  medianHoldMinutes: number | null;
  earlyEntries: number;
  flags: string[];
  tokens: BoardTokenSummary[];
  lastTradeAt: string | null;
  coverage?: "full" | "pools";
}

interface BoardToken {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  priceUsd: number | null;
  volume24hUsd: number;
  traders: number;
  swaps: number;
}

interface Board {
  generatedAt: string;
  windowDays: number;
  stats: {
    tokensRequested: number;
    tokensScanned: number;
    txFetched: number;
    swapsTotal: number;
    durationMs: number;
  };
  tokens: BoardToken[];
  walletsSeen: number;
  totals: {
    ranked: number;
    matching: number;
    profitable: number;
    pnlUsd: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  wallets: BoardWallet[];
  warnings: string[];
  building?: boolean;
  message?: string;
}

type SortKey =
  | "score"
  | "totalPnlUsd"
  | "realizedPnlUsd"
  | "roi"
  | "winRate"
  | "tokensTraded"
  | "medianHoldMinutes"
  | "earlyEntries"
  | "volumeUsd"
  | "lastTradeAt";

export function SmartTradersBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [minTokens, setMinTokens] = useState(2);
  const [minWin, setMinWin] = useState(0.5);
  const [hideBots, setHideBots] = useState(true);
  const [profitableOnly, setProfitableOnly] = useState(true);
  const [tokenFilter, setTokenFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: sortKey,
      dir: sortDir,
      minTokens: String(minTokens),
      minWin: String(minWin),
      profitable: profitableOnly ? "1" : "0",
      hideBots: hideBots ? "1" : "0",
    });
    if (tokenFilter) params.set("token", tokenFilter);
    return params.toString();
  }, [
    page,
    pageSize,
    sortKey,
    sortDir,
    minTokens,
    minWin,
    profitableOnly,
    hideBots,
    tokenFilter,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/leaderboard/smart-traders?${query}`);
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

  const rows = board?.wallets ?? [];
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
  const changeMinTokens = setFilter(setMinTokens);
  const changeMinWin = setFilter(setMinWin);
  const changeHideBots = setFilter(setHideBots);
  const changeProfitableOnly = setFilter(setProfitableOnly);
  const changeTokenFilter = setFilter(setTokenFilter);

  return (
    <main className="mx-auto flex w-full max-w-[var(--page-max)] flex-1 flex-col gap-5 px-[var(--page-gutter)] py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className="border-rule bg-paper-2 inline-flex h-12 w-12 items-center justify-center rounded-xl border"
            >
              <Crosshair className="text-accent h-5 w-5" />
            </span>
            <h1 className="text-ink text-[28px] font-semibold tracking-tight sm:text-[32px]">
              Smart Traders
            </h1>
          </div>
          <p className="text-muted max-w-2xl text-[15px]">
            Wallets trading the most active meme tokens on Solana, ranked by
            FIFO profit across those tokens. Every number comes from the
            wallets&apos; own swaps on-chain. Snipers and bots are flagged
            because a human cannot copy them.
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
          label="Tokens tracked"
          value={board ? board.tokens.length.toLocaleString() : "–"}
          hint={board ? `last ${board.windowDays} days` : undefined}
        />
        <Kpi
          label="Swaps"
          value={board ? board.stats.swapsTotal.toLocaleString() : "–"}
          hint={
            board
              ? `${board.stats.txFetched.toLocaleString()} tx read`
              : undefined
          }
        />
        <Kpi
          label="Wallets seen"
          value={board ? board.walletsSeen.toLocaleString() : "–"}
        />
        <Kpi
          label="Ranked"
          value={totals ? totals.ranked.toLocaleString() : "–"}
          hint="≥ 2 tokens"
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

      {board && board.tokens.length > 0 && (
        <section className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted mr-1 text-xs uppercase">Tokens</span>
          {board.tokens.slice(0, 24).map((token) => (
            <button
              key={token.mint}
              type="button"
              onClick={() =>
                changeTokenFilter(tokenFilter === token.mint ? "" : token.mint)
              }
              title={`${token.name} · ${token.traders} traders · ${token.swaps} swaps`}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                tokenFilter === token.mint
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-rule bg-paper-2 text-ink-2 hover:border-rule-2 hover:text-ink",
              )}
            >
              <TokenMark
                token={{ symbol: token.symbol, logo: token.logo ?? "" }}
                className="h-4 w-4"
              />
              {token.symbol}
              <span className="text-muted">{token.traders}</span>
            </button>
          ))}
          {tokenFilter && (
            <Link
              href={`/token/${tokenFilter}`}
              className="text-accent hover:text-focus ml-1 text-xs underline decoration-dotted underline-offset-4"
            >
              Open token page
            </Link>
          )}
        </section>
      )}

      <section className="border-rule bg-paper-2 rounded-xl border">
        <div className="border-rule flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={profitableOnly}
              onChange={(e) => changeProfitableOnly(e.target.checked)}
              className="accent-accent h-4 w-4"
            />
            Profitable only
          </label>
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hideBots}
              onChange={(e) => changeHideBots(e.target.checked)}
              className="accent-accent h-4 w-4"
            />
            Hide bots &amp; snipers
          </label>
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            Min tokens
            <select
              value={minTokens}
              onChange={(e) => changeMinTokens(Number(e.target.value))}
              className="border-rule bg-paper text-ink h-8 rounded-lg border px-2 text-sm outline-none"
            >
              {[2, 3, 4, 6].map((n) => (
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
              {[0, 0.5, 0.6, 0.75].map((n) => (
                <option key={n} value={n}>
                  {Math.round(n * 100)}%
                </option>
              ))}
            </select>
          </label>
          <span className="text-muted ml-auto text-xs">
            {totals ? `${totals.matching.toLocaleString()} wallets` : ""}
            {loading && board && " · updating…"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-paper-3/50">
              <tr>
                <th className="text-muted w-12 px-4 py-2.5 text-left text-xs font-medium uppercase">
                  #
                </th>
                <Th
                  label="Wallet"
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
                  label="PnL"
                  sortKey="totalPnlUsd"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Realized + unrealized, USD"
                />
                <Th
                  label="Realized"
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
                />
                <Th
                  label="Win rate"
                  sortKey="winRate"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Profitable tokens / tokens traded"
                />
                <Th
                  label="Tokens"
                  sortKey="tokensTraded"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  align="left"
                />
                <Th
                  label="Hold"
                  sortKey="medianHoldMinutes"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Median holding time"
                />
                <Th
                  label="Early"
                  sortKey="earlyEntries"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  title="Tokens entered within 30 min of launch or among the first 10 buyers"
                />
                <Th
                  label="Volume"
                  sortKey="volumeUsd"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
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
                <th className="w-14 px-2 py-2.5" aria-label="Watch" />
              </tr>
            </thead>
            <tbody className="divide-rule divide-y">
              {loading &&
                !board &&
                Array.from({ length: 8 }).map((_, index) => (
                  <tr key={index}>
                    <td colSpan={14} className="px-4 py-3.5">
                      <div className="bg-paper-3 h-4 animate-pulse rounded" />
                    </td>
                  </tr>
                ))}
              {error && (
                <tr>
                  <td
                    colSpan={14}
                    className="px-4 py-10 text-center text-sm text-[#fb7185]"
                  >
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={14}
                    className="text-muted px-4 py-10 text-center"
                  >
                    No wallet matches these filters.
                  </td>
                </tr>
              )}
              {rows.map((wallet, index) => (
                <tr
                  key={wallet.owner}
                  className="hover:bg-paper-3/40 transition-colors"
                >
                  <td className="data text-muted px-4 py-3">
                    {(board!.pagination.page - 1) * board!.pagination.pageSize +
                      index +
                      1}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/analysis?owner=${wallet.owner}`}
                      className="data text-accent hover:text-focus underline decoration-dotted underline-offset-4"
                      title={wallet.owner}
                    >
                      {shortAddress(wallet.owner)}
                    </Link>
                    {wallet.coverage === "full" && (
                      <span
                        className="bg-accent-soft text-accent ml-2 inline-flex h-5 items-center rounded px-1.5 align-middle text-[10px] font-medium uppercase"
                        title="Built from the wallet's own 30-day history (all tokens)"
                      >
                        Full
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ScoreBadge score={wallet.score} />
                  </td>
                  <td
                    className={cn(
                      "data px-4 py-3 text-right font-medium",
                      tone(wallet.totalPnlUsd),
                    )}
                  >
                    {formatUsd(wallet.totalPnlUsd)}
                  </td>
                  <td
                    className={cn(
                      "data px-4 py-3 text-right",
                      tone(wallet.realizedPnlUsd),
                    )}
                  >
                    {formatUsd(wallet.realizedPnlUsd)}
                  </td>
                  <td
                    className={cn(
                      "data px-4 py-3 text-right",
                      tone(wallet.roi),
                    )}
                  >
                    {(wallet.roi * 100).toFixed(0)}%
                  </td>
                  <td
                    className={cn(
                      "data px-4 py-3 text-right",
                      wallet.winRate >= 0.5
                        ? "text-[#4ade80]"
                        : "text-[#fb7185]",
                    )}
                  >
                    {(wallet.winRate * 100).toFixed(0)}%
                    <span className="text-muted">
                      {" "}
                      · {wallet.tokensProfitable}/{wallet.tokensTraded}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex max-w-[20rem] flex-wrap gap-1">
                      {wallet.tokens.slice(0, 4).map((token) => (
                        <Link
                          key={token.mint}
                          href={`/token/${token.mint}`}
                          className={cn(
                            "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors",
                            token.totalPnlUsd >= 0
                              ? "bg-[#22c55e]/10 text-[#4ade80] hover:bg-[#22c55e]/20"
                              : "bg-[#f43f5e]/10 text-[#fb7185] hover:bg-[#f43f5e]/20",
                          )}
                          title={`${token.name}: ${formatUsd(token.totalPnlUsd)}${token.closed ? "" : " (open)"}`}
                        >
                          <TokenMark
                            token={{
                              symbol: token.symbol,
                              logo: token.logo ?? "",
                            }}
                            className="h-3.5 w-3.5"
                          />
                          {token.symbol}
                        </Link>
                      ))}
                      {wallet.tokensTraded > 4 && (
                        <span className="text-muted inline-flex h-6 items-center text-[11px]">
                          +{wallet.tokensTraded - 4}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="data text-ink px-4 py-3 text-right">
                    {humanMinutes(wallet.medianHoldMinutes)}
                  </td>
                  <td className="data text-ink px-4 py-3 text-right">
                    {wallet.earlyEntries}
                    <span className="text-muted">/{wallet.tokensTraded}</span>
                  </td>
                  <td className="data text-ink px-4 py-3 text-right">
                    {formatUsd(wallet.volumeUsd)}
                  </td>
                  <td className="px-4 py-3">
                    <FlagPills flags={wallet.flags} />
                  </td>
                  <td className="data text-ink-2 px-4 py-3 text-right whitespace-nowrap">
                    {relative(wallet.lastTradeAt)}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <WatchButton owner={wallet.owner} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {board && (
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
              Score = 35% win rate (confidence-weighted) + 30% PnL + 15% ROI +
              10% token breadth + 10% early entries, minus sniper/bot penalties.
              PnL is FIFO on the wallet&apos;s own swaps; tokens sold without a
              visible buy are excluded.
            </span>
            {board.warnings.length > 0 && (
              <span>{board.warnings.length} warning(s)</span>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
