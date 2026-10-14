"use client";

import {
  ArrowLeft,
  Copy,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  formatUsd,
  Kpi,
  relative,
  ScoreBadge,
  shortAddress,
  tone,
} from "@/components/board-ui";
import {
  FollowButton,
  MarketLogo,
  PerpFlags,
  SideBadge,
  type ThemedLogo,
} from "@/components/predict-ui";
import { perpWatchlist } from "@/lib/local-list";
import { cn } from "@/lib/utils";

interface Position {
  instrumentId: number;
  symbol: string;
  logo: ThemedLogo | null;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  roe: number;
}

interface Fill {
  tradeId: number;
  at: string;
  symbol: string;
  logo: ThemedLogo | null;
  side: "long" | "short";
  price: number;
  quantity: number;
  notionalUsd: number;
  pnlUsd: number;
  feeUsd: number;
  taker: boolean;
  liquidation: boolean;
  action: "open" | "close";
}

interface Profile {
  address: string;
  ranked: boolean;
  rank: number | null;
  score: number;
  metrics: {
    closedTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    realizedPnlUsd: number;
    feesUsd: number;
    profitFactor: number | null;
    fills: number;
    notionalUsd: number;
    avgFillNotionalUsd: number;
    longShare: number;
    takerShare: number;
    liquidations: number;
    topWinShare: number;
    instruments: Array<{
      instrumentId: number;
      symbol: string;
      logo: ThemedLogo | null;
      category: string;
      trades: number;
      wins: number;
      pnlUsd: number;
    }>;
    days: number;
    positiveDays: number;
    pnl30dUsd: number;
    maxDrawdownUsd: number;
    equityUsd: number;
    openPositions: Position[];
    openNotionalUsd: number;
    unrealizedPnlUsd: number;
    lastFillAt: string | null;
    flags: string[];
  };
  leaderboard: {
    pnlMonth: number | null;
    roiMonth: number | null;
    notionalMonth: number | null;
    rankMonth: number | null;
    pnlWeek: number | null;
    rankWeek: number | null;
  } | null;
  bigWins: Array<{
    symbol: string;
    side: "long" | "short";
    pnlUsd: number;
    at: string;
  }>;
  series: Array<[number, number]>;
  fills: Fill[];
  fillsTruncated: boolean;
  generatedAt: string;
  message?: string;
}

function PnlBars({ series }: { series: Array<[number, number]> }) {
  const max = Math.max(1, ...series.map(([, v]) => Math.abs(v)));
  return (
    <div
      className="flex h-16 items-end gap-[2px]"
      aria-label="Daily PnL, last 30 days"
    >
      {series.map(([ts, v]) => (
        <span
          key={ts}
          title={`${new Date(ts).toLocaleDateString()}: ${formatUsd(v)}`}
          className={cn(
            "flex-1 rounded-sm",
            v >= 0 ? "bg-[#22c55e]/70" : "bg-[#f43f5e]/70",
          )}
          style={{ height: `${Math.max(2, (Math.abs(v) / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function PerpTraderView({ address }: { address: string }) {
  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"open" | "fills" | "markets">("open");
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/predict/perps/${address}${refresh ? "?refresh=1" : ""}`,
        );
        const payload = (await response.json()) as Profile;
        if (!response.ok)
          throw new Error(payload.message || `HTTP ${response.status}`);
        setData(payload);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load account");
      } finally {
        setLoading(false);
      }
    },
    [address],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const m = data?.metrics;
  const closes = useMemo(
    () => data?.fills.filter((f) => f.action === "close") ?? [],
    [data],
  );

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[var(--page-max)] flex-1 flex-col gap-5 px-[var(--page-gutter)] py-8">
      <Link
        href="/predict?tab=perp"
        className="text-muted hover:text-ink inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Perp traders
      </Link>

      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-ink flex items-center gap-3 text-[26px] font-semibold tracking-tight sm:text-[30px]">
            <span className="data">{shortAddress(address)}</span>
            {data && <ScoreBadge score={data.score} />}
            {data?.rank && (
              <span className="bg-accent-soft text-accent rounded px-1.5 py-0.5 text-xs font-medium">
                #{data.rank} Perp
              </span>
            )}
          </h1>
          <div className="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <button
              type="button"
              onClick={copyAddress}
              className="data hover:text-ink inline-flex items-center gap-1"
              title={address}
            >
              {address} <Copy className="h-3 w-3" />{" "}
              {copied && <span className="text-accent">copied</span>}
            </button>
            <a
              href={`https://polymarket.com/profile/${address}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink inline-flex items-center gap-1"
            >
              Polymarket profile <ExternalLink className="h-3 w-3" />
            </a>
            {data?.leaderboard?.rankMonth && (
              <span>
                #{data.leaderboard.rankMonth} on the monthly perps leaderboard ·
                ROI {((data.leaderboard.roiMonth ?? 0) * 100).toFixed(0)}%
              </span>
            )}
            {data && <span>updated {relative(data.generatedAt)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FollowButton address={address} label list={perpWatchlist} />
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
            Refresh
          </button>
        </div>
      </section>

      {error && (
        <p className="px-4 py-6 text-center text-sm text-[#fb7185]">{error}</p>
      )}

      <section className="border-rule bg-paper-2 divide-rule grid grid-cols-2 divide-x divide-y rounded-xl border sm:grid-cols-4 lg:grid-cols-8 lg:divide-y-0">
        <Kpi
          label="Win rate"
          value={m ? `${(m.winRate * 100).toFixed(0)}%` : "–"}
          hint={m ? `${m.wins} won · ${m.losses} lost` : undefined}
          valueClassName={m && m.winRate >= 0.55 ? "text-[#4ade80]" : undefined}
        />
        <Kpi
          label="PnL 30d"
          value={m ? formatUsd(m.pnl30dUsd) : "–"}
          valueClassName={m ? tone(m.pnl30dUsd) : undefined}
          hint={m ? `${m.positiveDays}/${m.days} positive days` : undefined}
        />
        <Kpi
          label="Realized (sample)"
          value={m ? formatUsd(m.realizedPnlUsd) : "–"}
          valueClassName={m ? tone(m.realizedPnlUsd) : undefined}
          hint={
            m ? `${m.fills} fills · fees ${formatUsd(m.feesUsd)}` : undefined
          }
        />
        <Kpi
          label="Profit factor"
          value={
            m ? (m.profitFactor == null ? "∞" : m.profitFactor.toFixed(2)) : "–"
          }
          hint={
            m
              ? `top win ${Math.round(m.topWinShare * 100)}% of profit`
              : undefined
          }
        />
        <Kpi
          label="Max drawdown"
          value={
            m
              ? m.maxDrawdownUsd > 0
                ? `-${formatUsd(m.maxDrawdownUsd)}`
                : "–"
              : "–"
          }
          valueClassName="text-[#fb7185]"
        />
        <Kpi
          label="Equity"
          value={m ? formatUsd(m.equityUsd) : "–"}
          hint={
            m && m.equityUsd > 0
              ? `${(m.openNotionalUsd / m.equityUsd).toFixed(1)}× open`
              : undefined
          }
        />
        <Kpi
          label="Avg fill"
          value={m ? formatUsd(m.avgFillNotionalUsd) : "–"}
          hint={
            m
              ? `${Math.round(m.longShare * 100)}% long · ${Math.round(m.takerShare * 100)}% taker`
              : undefined
          }
        />
        <Kpi
          label="Open"
          value={m ? String(m.openPositions.length) : "–"}
          hint={
            m
              ? `${formatUsd(m.openNotionalUsd)} · ${formatUsd(m.unrealizedPnlUsd)} unrealized`
              : undefined
          }
        />
      </section>

      {data && (
        <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="border-rule bg-paper-2 rounded-xl border px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-ink font-medium">Daily PnL · 30 days</span>
              <PerpFlags flags={m?.flags ?? []} />
            </div>
            {data.series.length ? (
              <PnlBars series={data.series} />
            ) : (
              <p className="text-muted text-xs">No daily PnL yet.</p>
            )}
          </div>
          <div className="border-rule bg-paper-2 rounded-xl border px-4 py-3">
            <span className="text-ink text-xs font-medium">
              Biggest wins (month)
            </span>
            {data.bigWins.length === 0 ? (
              <p className="text-muted mt-2 text-xs">
                Not on the monthly wins board.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {data.bigWins.map((w, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-ink">{w.symbol}</span>
                      <SideBadge side={w.side} />
                    </span>
                    <span className="data text-[#4ade80]">
                      {formatUsd(w.pnlUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <section className="border-rule bg-paper-2 rounded-xl border">
        <div className="border-rule flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="bg-paper-3 inline-flex h-9 items-center rounded-lg p-0.5">
            {(["open", "fills", "markets"] as const).map((item) => (
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
                {item === "open"
                  ? `Open positions (${m?.openPositions.length ?? 0})`
                  : item === "fills"
                    ? `Realized trades (${closes.length})`
                    : "Markets"}
              </button>
            ))}
          </div>
          {tab === "open" && (
            <span className="text-muted text-xs">
              What a copier would hold right now. Mirror on Polymarket Perps.
            </span>
          )}
          {tab === "fills" && data?.fillsTruncated && (
            <span className="text-muted text-xs">Latest 300 fills only.</span>
          )}
        </div>

        {loading && !data && (
          <div className="flex flex-col gap-3 px-4 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-paper-3 h-4 animate-pulse rounded" />
            ))}
          </div>
        )}

        {m && tab === "open" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-paper-3/50">
                <tr>
                  <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                    Market
                  </th>
                  <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                    Side
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Size
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Entry
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Notional
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Unrealized
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    ROE
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Copy
                  </th>
                </tr>
              </thead>
              <tbody className="divide-rule divide-y">
                {m.openPositions.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="text-muted px-4 py-10 text-center"
                    >
                      No open position.
                    </td>
                  </tr>
                )}
                {m.openPositions.map((p) => (
                  <tr
                    key={`${p.instrumentId}-${p.side}`}
                    className="hover:bg-paper-3/40"
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <MarketLogo logo={p.logo} symbol={p.symbol} />
                        <span className="text-ink font-medium">
                          {p.symbol.replace("-USD", "")}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <SideBadge side={p.side} />
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {p.size.toLocaleString("en-US", {
                        maximumFractionDigits: 4,
                      })}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {p.entryPrice.toLocaleString("en-US", {
                        maximumFractionDigits: 4,
                      })}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {formatUsd(p.notionalUsd)}
                    </td>
                    <td
                      className={cn(
                        "data px-4 py-2.5 text-right font-medium",
                        tone(p.unrealizedPnlUsd),
                      )}
                    >
                      {formatUsd(p.unrealizedPnlUsd)}
                    </td>
                    <td
                      className={cn("data px-4 py-2.5 text-right", tone(p.roe))}
                    >
                      {(p.roe * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`https://polymarket.com/perps/${p.symbol.toLowerCase()}`}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-accent text-accent-ink hover:bg-focus inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && tab === "fills" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-paper-3/50">
                <tr>
                  <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                    Time
                  </th>
                  <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                    Market
                  </th>
                  <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                    Fill
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Price
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Notional
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Realized
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Fee
                  </th>
                </tr>
              </thead>
              <tbody className="divide-rule divide-y">
                {closes.map((f) => (
                  <tr key={f.tradeId} className="hover:bg-paper-3/40">
                    <td className="data text-ink-2 px-4 py-2.5 whitespace-nowrap">
                      {relative(f.at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <MarketLogo logo={f.logo} symbol={f.symbol} size={5} />
                        <span className="text-ink">
                          {f.symbol.replace("-USD", "")}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <SideBadge side={f.side} />
                        {f.liquidation && (
                          <span className="rounded bg-[#f43f5e]/10 px-1.5 text-[10px] font-semibold text-[#fb7185] uppercase">
                            liq
                          </span>
                        )}
                        {!f.taker && (
                          <span className="text-muted text-[10px]">maker</span>
                        )}
                      </span>
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {f.price.toLocaleString("en-US", {
                        maximumFractionDigits: 4,
                      })}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {formatUsd(f.notionalUsd)}
                    </td>
                    <td
                      className={cn(
                        "data px-4 py-2.5 text-right font-medium",
                        tone(f.pnlUsd),
                      )}
                    >
                      {formatUsd(f.pnlUsd, 2)}
                    </td>
                    <td className="data text-muted px-4 py-2.5 text-right">
                      {formatUsd(f.feeUsd, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {m && tab === "markets" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="bg-paper-3/50">
                <tr>
                  <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                    Market
                  </th>
                  <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                    Category
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Trades
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Win rate
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Realized
                  </th>
                </tr>
              </thead>
              <tbody className="divide-rule divide-y">
                {m.instruments.map((i) => (
                  <tr key={i.instrumentId} className="hover:bg-paper-3/40">
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <MarketLogo logo={i.logo} symbol={i.symbol} />
                        <span className="text-ink font-medium">
                          {i.symbol.replace("-USD", "")}
                        </span>
                      </span>
                    </td>
                    <td className="text-ink-2 px-4 py-2.5 capitalize">
                      {i.category}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {i.trades}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {Math.round((i.wins / Math.max(1, i.trades)) * 100)}%
                    </td>
                    <td
                      className={cn(
                        "data px-4 py-2.5 text-right font-medium",
                        tone(i.pnlUsd),
                      )}
                    >
                      {formatUsd(i.pnlUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
