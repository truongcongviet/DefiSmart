"use client";

import { ArrowLeft, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  FlagPills,
  formatCompact,
  formatPrice,
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

interface Row {
  owner: string;
  score: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  costUsd: number;
  buys: number;
  sells: number;
  avgHoldMinutes: number | null;
  earlyRank: number | null;
  entryDelaySec: number | null;
  closed: boolean;
  firstBuyAt: string | null;
  lastTradeAt: string;
  tokensTraded: number;
  winRate: number | null;
  flags: string[];
}

interface Swap {
  signature: string;
  blockTime: number;
  wallet: string;
  side: "buy" | "sell";
  tokenAmount: number;
  quoteUsd: number;
  priceUsd: number;
}

interface Result {
  token: {
    mint: string;
    symbol: string;
    name: string;
    logo: string | null;
    priceUsd: number | null;
    marketCapUsd: number | null;
    liquidityUsd: number;
    volume24hUsd: number;
    createdAt: number | null;
    scannedAt: string;
  };
  tracked: boolean;
  generatedAt: string;
  windowDays: number;
  totals: {
    wallets: number;
    swaps: number;
    buys: number;
    sells: number;
    volumeUsd: number;
    profitable: number;
    losing: number;
  };
  traders: Row[];
  recent: Swap[];
  warnings: string[];
  message?: string;
}

type SortKey =
  | "totalPnlUsd"
  | "realizedPnlUsd"
  | "costUsd"
  | "avgHoldMinutes"
  | "earlyRank"
  | "score"
  | "lastTradeAt";

function entryLabel(row: Row) {
  if (row.entryDelaySec == null)
    return row.earlyRank ? `#${row.earlyRank}` : "–";
  const minutes = row.entryDelaySec / 60;
  const when =
    minutes < 60
      ? `${Math.round(minutes)}m`
      : minutes < 1440
        ? `${(minutes / 60).toFixed(1)}h`
        : `${(minutes / 1440).toFixed(1)}d`;
  return row.earlyRank ? `#${row.earlyRank} · +${when}` : `+${when}`;
}

export function TokenTraders({ mint }: { mint: string }) {
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalPnlUsd");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [closedOnly, setClosedOnly] = useState(false);
  const [tab, setTab] = useState<"traders" | "swaps">("traders");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/tokens/${mint}/traders${refresh ? "?refresh=1" : ""}`,
        );
        const payload = (await response.json()) as Result;
        if (!response.ok)
          throw new Error(payload.message || `HTTP ${response.status}`);
        setData(payload);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load token");
      } finally {
        setLoading(false);
      }
    },
    [mint],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const filtered = data.traders.filter((row) => !closedOnly || row.closed);
    const sign = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "lastTradeAt")
        return sign * (Date.parse(a.lastTradeAt) - Date.parse(b.lastTradeAt));
      const av = a[sortKey] ?? (sortKey === "earlyRank" ? Infinity : -Infinity);
      const bv = b[sortKey] ?? (sortKey === "earlyRank" ? Infinity : -Infinity);
      return sign * ((av as number) - (bv as number));
    });
  }, [data, closedOnly, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  function onSort(key: SortKey) {
    if (key === sortKey) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else {
      setSortKey(key);
      setSortDir(key === "earlyRank" ? "asc" : "desc");
    }
    setPage(1);
  }

  const token = data?.token;
  const age = token?.createdAt
    ? (Date.now() / 1000 - token.createdAt) / 86_400
    : null;

  return (
    <main className="mx-auto flex w-full max-w-[var(--page-max)] flex-1 flex-col gap-5 px-[var(--page-gutter)] py-8">
      <Link
        href="/traders"
        className="text-muted hover:text-ink inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Smart Traders
      </Link>

      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          {token ? (
            <TokenMark
              token={{ symbol: token.symbol, logo: token.logo ?? "" }}
              className="h-12 w-12 text-base"
            />
          ) : (
            <span className="bg-paper-3 h-12 w-12 animate-pulse rounded-full" />
          )}
          <div className="flex flex-col gap-1">
            <h1 className="text-ink text-[26px] font-semibold tracking-tight sm:text-[30px]">
              {token ? token.symbol : "Token"}
              {token && (
                <span className="text-muted ml-3 text-base font-normal">
                  {token.name}
                </span>
              )}
            </h1>
            <div className="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="data" title={mint}>
                {shortAddress(mint)}
              </span>
              <a
                href={`https://dexscreener.com/solana/${mint}`}
                target="_blank"
                rel="noreferrer"
                className="hover:text-ink inline-flex items-center gap-1"
              >
                DexScreener <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href={`https://solscan.io/token/${mint}`}
                target="_blank"
                rel="noreferrer"
                className="hover:text-ink inline-flex items-center gap-1"
              >
                Solscan <ExternalLink className="h-3 w-3" />
              </a>
              {data && (
                <span>
                  {data.tracked
                    ? "tracked by the leaderboard scan"
                    : "scanned on demand"}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="border-rule text-ink-2 hover:border-rule-2 hover:text-ink inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors disabled:opacity-50"
        >
          {loading ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Rescan
        </button>
      </section>

      <section className="border-rule bg-paper-2 divide-rule grid grid-cols-2 divide-x divide-y rounded-xl border sm:grid-cols-4 lg:grid-cols-8 lg:divide-y-0">
        <Kpi label="Price" value={formatPrice(token?.priceUsd ?? null)} />
        <Kpi
          label="Market cap"
          value={token?.marketCapUsd ? formatUsd(token.marketCapUsd) : "–"}
        />
        <Kpi
          label="Liquidity"
          value={token ? formatUsd(token.liquidityUsd) : "–"}
        />
        <Kpi
          label="Volume 24h"
          value={token ? formatUsd(token.volume24hUsd) : "–"}
        />
        <Kpi
          label="Age"
          value={
            age != null
              ? age < 1
                ? `${Math.round(age * 24)}h`
                : `${age.toFixed(1)}d`
              : "–"
          }
        />
        <Kpi
          label="Traders"
          value={data ? data.totals.wallets.toLocaleString() : "–"}
          hint={
            data
              ? `${data.totals.profitable} up · ${data.totals.losing} down`
              : undefined
          }
        />
        <Kpi
          label="Swaps"
          value={data ? data.totals.swaps.toLocaleString() : "–"}
          hint={
            data
              ? `${data.totals.buys} buys · ${data.totals.sells} sells`
              : undefined
          }
        />
        <Kpi
          label="Scanned"
          value={data ? relative(data.token.scannedAt) : "–"}
          hint={data ? `last ${data.windowDays} days` : undefined}
        />
      </section>

      <section className="border-rule bg-paper-2 rounded-xl border">
        <div className="border-rule flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="bg-paper-3 inline-flex h-9 items-center rounded-lg p-0.5">
            {(["traders", "swaps"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={cn(
                  "h-8 rounded-md px-3 text-sm capitalize transition-colors",
                  tab === item
                    ? "bg-paper text-ink shadow-sm"
                    : "text-muted hover:text-ink",
                )}
              >
                {item === "traders" ? "Top traders" : "Recent swaps"}
              </button>
            ))}
          </div>
          {tab === "traders" && (
            <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={closedOnly}
                onChange={(e) => {
                  setClosedOnly(e.target.checked);
                  setPage(1);
                }}
                className="accent-accent h-4 w-4"
              />
              Fully exited only
            </label>
          )}
          <span className="text-muted ml-auto text-xs">
            {tab === "traders"
              ? `${rows.length} wallets`
              : `${data?.recent.length ?? 0} swaps`}
          </span>
        </div>

        {error && (
          <p className="px-4 py-10 text-center text-sm text-[#fb7185]">
            {error}
          </p>
        )}
        {loading && !data && (
          <div className="flex flex-col gap-3 px-4 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-paper-3 h-4 animate-pulse rounded" />
            ))}
          </div>
        )}

        {data && tab === "traders" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
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
                    label="PnL"
                    sortKey="totalPnlUsd"
                    active={sortKey}
                    direction={sortDir}
                    onSort={onSort}
                    title="Realized + unrealized on this token"
                  />
                  <Th
                    label="Realized"
                    sortKey="realizedPnlUsd"
                    active={sortKey}
                    direction={sortDir}
                    onSort={onSort}
                  />
                  <Th
                    label="Bought"
                    sortKey="costUsd"
                    active={sortKey}
                    direction={sortDir}
                    onSort={onSort}
                  />
                  <Th
                    label="Trades"
                    active={sortKey}
                    direction={sortDir}
                    onSort={onSort}
                  />
                  <Th
                    label="Hold"
                    sortKey="avgHoldMinutes"
                    active={sortKey}
                    direction={sortDir}
                    onSort={onSort}
                  />
                  <Th
                    label="Entry"
                    sortKey="earlyRank"
                    active={sortKey}
                    direction={sortDir}
                    onSort={onSort}
                    title="Buyer rank in the sample · delay after pool creation"
                  />
                  <Th
                    label="Status"
                    active={sortKey}
                    direction={sortDir}
                    onSort={onSort}
                    align="left"
                  />
                  <Th
                    label="Overall"
                    sortKey="score"
                    active={sortKey}
                    direction={sortDir}
                    onSort={onSort}
                    title="Score and win rate across all tracked tokens"
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
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={12}
                      className="text-muted px-4 py-10 text-center"
                    >
                      No trader found in the scanned window.
                    </td>
                  </tr>
                )}
                {pageRows.map((row, index) => (
                  <tr
                    key={row.owner}
                    className="hover:bg-paper-3/40 transition-colors"
                  >
                    <td className="data text-muted px-4 py-3">
                      {(currentPage - 1) * pageSize + index + 1}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/analysis?owner=${row.owner}`}
                        className="data text-accent hover:text-focus underline decoration-dotted underline-offset-4"
                        title={row.owner}
                      >
                        {shortAddress(row.owner)}
                      </Link>
                    </td>
                    <td
                      className={cn(
                        "data px-4 py-3 text-right font-medium",
                        tone(row.totalPnlUsd),
                      )}
                    >
                      {formatUsd(row.totalPnlUsd)}
                    </td>
                    <td
                      className={cn(
                        "data px-4 py-3 text-right",
                        tone(row.realizedPnlUsd),
                      )}
                    >
                      {formatUsd(row.realizedPnlUsd)}
                    </td>
                    <td className="data text-ink px-4 py-3 text-right">
                      {formatUsd(row.costUsd)}
                    </td>
                    <td className="data text-ink px-4 py-3 text-right">
                      <span className="text-[#4ade80]">{row.buys}</span>
                      <span className="text-muted"> / </span>
                      <span className="text-[#fb7185]">{row.sells}</span>
                    </td>
                    <td className="data text-ink px-4 py-3 text-right">
                      {humanMinutes(row.avgHoldMinutes)}
                    </td>
                    <td className="data text-ink px-4 py-3 text-right whitespace-nowrap">
                      {entryLabel(row)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium uppercase",
                          row.closed
                            ? "bg-paper-3 text-muted"
                            : "bg-accent-soft text-accent",
                        )}
                      >
                        {row.closed ? "Exited" : "Holding"}
                      </span>
                      {row.flags.length > 0 && (
                        <span className="ml-1 inline-flex align-middle">
                          <FlagPills
                            flags={row.flags.filter(
                              (f) => f === "bot" || f === "sniper",
                            )}
                          />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <ScoreBadge score={row.score} />
                      {row.winRate != null && (
                        <span className="data text-muted ml-2 text-xs">
                          {(row.winRate * 100).toFixed(0)}% · {row.tokensTraded}
                        </span>
                      )}
                    </td>
                    <td className="data text-ink-2 px-4 py-3 text-right whitespace-nowrap">
                      {relative(row.lastTradeAt)}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <WatchButton owner={row.owner} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={currentPage}
              pageSize={pageSize}
              total={rows.length}
              totalPages={totalPages}
              onPage={setPage}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        )}

        {data && tab === "swaps" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-paper-3/50">
                <tr>
                  <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                    Time
                  </th>
                  <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                    Side
                  </th>
                  <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                    Wallet
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Amount
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Value
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Price
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Tx
                  </th>
                </tr>
              </thead>
              <tbody className="divide-rule divide-y">
                {data.recent.map((swap) => (
                  <tr
                    key={`${swap.signature}-${swap.wallet}-${swap.side}`}
                    className="hover:bg-paper-3/40"
                  >
                    <td className="data text-ink-2 px-4 py-2.5 whitespace-nowrap">
                      {relative(new Date(swap.blockTime * 1000).toISOString())}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold uppercase",
                          swap.side === "buy"
                            ? "bg-[#22c55e]/15 text-[#4ade80]"
                            : "bg-[#f43f5e]/10 text-[#fb7185]",
                        )}
                      >
                        {swap.side}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/analysis?owner=${swap.wallet}`}
                        className="data text-accent hover:text-focus underline decoration-dotted underline-offset-4"
                      >
                        {shortAddress(swap.wallet)}
                      </Link>
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {formatCompact(swap.tokenAmount)}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {formatUsd(swap.quoteUsd, 2)}
                    </td>
                    <td className="data text-ink-2 px-4 py-2.5 text-right">
                      {formatPrice(swap.priceUsd)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`https://solscan.io/tx/${swap.signature}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted hover:text-ink inline-flex"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.warnings.length > 0 && (
          <div className="text-muted border-rule border-t px-4 py-2.5 text-xs">
            {data.warnings.join(" · ")}
          </div>
        )}
      </section>
    </main>
  );
}
