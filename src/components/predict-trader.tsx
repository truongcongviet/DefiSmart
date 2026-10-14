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
  shortAddress,
  tone,
} from "@/components/board-ui";
import {
  Avatar,
  CATEGORY_LABEL,
  FollowButton,
  PredictFlags,
  priceCents,
} from "@/components/predict-ui";
import { cn } from "@/lib/utils";

interface Live {
  conditionId: string;
  title: string;
  slug: string;
  eventSlug: string;
  icon?: string;
  outcome: string;
  size: number;
  avgPrice: number;
  curPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  endDate?: string;
}

interface Bet {
  conditionId: string;
  title: string;
  eventSlug: string;
  icon?: string;
  costUsd: number;
  pnlUsd: number;
  at: number;
  entryPrice: number;
}

interface Trade {
  timestamp: number;
  type: string;
  side: string;
  size: number;
  usdcSize: number;
  price: number;
  title: string;
  eventSlug: string;
  outcome: string;
  transactionHash: string;
}

interface Profile {
  address: string;
  name: string;
  pseudonym: string | null;
  verified: boolean;
  profileImage: string | null;
  xUsername: string | null;
  memberSince: string | null;
  ranked: boolean;
  rank: number | null;
  score: number;
  metrics: {
    markets: number;
    wins: number;
    losses: number;
    markets30d: number;
    winRate30d: number | null;
    winRate: number;
    realizedPnlUsd: number;
    costUsd: number;
    roi: number;
    profitFactor: number | null;
    avgStakeUsd: number;
    medianStakeUsd: number;
    topWinShare: number;
    avgWinEntryPrice: number | null;
    categories: Array<{
      category: string;
      markets: number;
      wins: number;
      pnlUsd: number;
    }>;
    openPositions: number;
    openExposureUsd: number;
    openValueUsd: number;
    unrealizedPnlUsd: number;
    lastTradeAt: string | null;
    flags: string[];
  };
  live: Live[];
  recentBets: Bet[];
  activity: Trade[];
  truncated: boolean;
  generatedAt: string;
  message?: string;
}

function eventUrl(slug: string) {
  return `https://polymarket.com/event/${slug}`;
}

export function PredictTraderView({ address }: { address: string }) {
  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"live" | "settled" | "trades">("live");
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/predict/traders/${address}${refresh ? "?refresh=1" : ""}`,
        );
        const payload = (await response.json()) as Profile;
        if (!response.ok)
          throw new Error(payload.message || `HTTP ${response.status}`);
        setData(payload);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load trader");
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
  const liveSorted = useMemo(() => data?.live ?? [], [data]);

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
        href="/predict"
        className="text-muted hover:text-ink inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> PredictSmart
      </Link>

      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          {data ? (
            <Avatar src={data.profileImage} name={data.name} size={12} />
          ) : (
            <span className="bg-paper-3 h-12 w-12 animate-pulse rounded-full" />
          )}
          <div className="flex flex-col gap-1">
            <h1 className="text-ink flex items-center gap-2 text-[26px] font-semibold tracking-tight sm:text-[30px]">
              {data ? data.name : "Trader"}
              {data?.verified && <span className="text-accent text-sm">✓</span>}
              {data?.rank && (
                <span className="bg-accent-soft text-accent rounded px-1.5 py-0.5 text-xs font-medium">
                  #{data.rank} PredictSmart
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
                {shortAddress(address)} <Copy className="h-3 w-3" />{" "}
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
              {data?.xUsername && (
                <a
                  href={`https://x.com/${data.xUsername}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-ink inline-flex items-center gap-1"
                >
                  @{data.xUsername} <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {data?.memberSince && (
                <span>
                  since {new Date(data.memberSince).toLocaleDateString()}
                </span>
              )}
              {data && <span>updated {relative(data.generatedAt)}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FollowButton address={address} label />
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
        <Kpi label="Score" value={data ? String(data.score) : "–"} />
        <Kpi
          label="Win rate"
          value={m ? `${(m.winRate * 100).toFixed(0)}%` : "–"}
          hint={m ? `${m.wins} won · ${m.losses} lost` : undefined}
          valueClassName={m && m.winRate >= 0.55 ? "text-[#4ade80]" : undefined}
        />
        <Kpi
          label="Last 30 days"
          value={
            m?.winRate30d == null ? "–" : `${(m.winRate30d * 100).toFixed(0)}%`
          }
          hint={m ? `${m.markets30d} markets` : undefined}
        />
        <Kpi
          label="Realized PnL"
          value={m ? formatUsd(m.realizedPnlUsd) : "–"}
          valueClassName={m ? tone(m.realizedPnlUsd) : undefined}
          hint={m ? `on ${formatUsd(m.costUsd)} staked` : undefined}
        />
        <Kpi
          label="ROI"
          value={m ? `${(m.roi * 100).toFixed(0)}%` : "–"}
          valueClassName={m ? tone(m.roi) : undefined}
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
          label="Stake"
          value={m ? formatUsd(m.medianStakeUsd) : "–"}
          hint={m ? `median · avg ${formatUsd(m.avgStakeUsd)}` : undefined}
        />
        <Kpi
          label="Open"
          value={m ? `${m.openPositions}` : "–"}
          hint={
            m
              ? `${formatUsd(m.openExposureUsd)} · ${formatUsd(m.unrealizedPnlUsd)} unrealized`
              : undefined
          }
        />
      </section>

      {m && (
        <section className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Focus</span>
          {m.categories.map((c) => (
            <span
              key={c.category}
              className="bg-paper-2 border-rule text-ink-2 inline-flex h-6 items-center gap-1 rounded-md border px-2"
            >
              {CATEGORY_LABEL[c.category] ?? c.category}
              <span className="data text-muted">
                {c.markets} ·{" "}
                {Math.round((c.wins / Math.max(1, c.markets)) * 100)}%
              </span>
              <span className={cn("data", tone(c.pnlUsd))}>
                {formatUsd(c.pnlUsd)}
              </span>
            </span>
          ))}
          <span className="text-muted ml-2">Flags</span>
          <PredictFlags flags={m.flags} />
          {data?.truncated && (
            <span className="text-muted">
              · history truncated to the latest settled markets
            </span>
          )}
        </section>
      )}

      <section className="border-rule bg-paper-2 rounded-xl border">
        <div className="border-rule flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="bg-paper-3 inline-flex h-9 items-center rounded-lg p-0.5">
            {(["live", "settled", "trades"] as const).map((item) => (
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
                {item === "live"
                  ? `Open positions (${data?.live.length ?? 0})`
                  : item === "settled"
                    ? "Settled markets"
                    : "Recent trades"}
              </button>
            ))}
          </div>
          {tab === "live" && (
            <span className="text-muted text-xs">
              What a copier would hold right now. Open the market on Polymarket
              to mirror it.
            </span>
          )}
        </div>

        {loading && !data && (
          <div className="flex flex-col gap-3 px-4 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-paper-3 h-4 animate-pulse rounded" />
            ))}
          </div>
        )}

        {data && tab === "live" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-paper-3/50">
                <tr>
                  <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                    Market
                  </th>
                  <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                    Side
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Entry
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Now
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Shares
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Cost
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Value
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    PnL
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Ends
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Copy
                  </th>
                </tr>
              </thead>
              <tbody className="divide-rule divide-y">
                {liveSorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="text-muted px-4 py-10 text-center"
                    >
                      No open position.
                    </td>
                  </tr>
                )}
                {liveSorted.map((p) => (
                  <tr
                    key={`${p.conditionId}-${p.outcome}`}
                    className="hover:bg-paper-3/40"
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        {p.icon && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.icon}
                            alt=""
                            className="border-rule h-6 w-6 shrink-0 rounded-md border object-cover"
                          />
                        )}
                        <span
                          className="text-ink max-w-[26rem] truncate"
                          title={p.title}
                        >
                          {p.title}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold uppercase",
                          /^(yes|up)$/i.test(p.outcome)
                            ? "bg-[#22c55e]/15 text-[#4ade80]"
                            : /^(no|down)$/i.test(p.outcome)
                              ? "bg-[#f43f5e]/10 text-[#fb7185]"
                              : "bg-accent-soft text-accent",
                        )}
                      >
                        {p.outcome}
                      </span>
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {priceCents(p.avgPrice)}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {priceCents(p.curPrice)}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {Math.round(p.size).toLocaleString()}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {formatUsd(p.initialValue)}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {formatUsd(p.currentValue)}
                    </td>
                    <td
                      className={cn(
                        "data px-4 py-2.5 text-right font-medium",
                        tone(p.cashPnl),
                      )}
                    >
                      {formatUsd(p.cashPnl)}{" "}
                      <span className="text-muted">
                        ({p.percentPnl.toFixed(0)}%)
                      </span>
                    </td>
                    <td className="data text-ink-2 px-4 py-2.5 text-right whitespace-nowrap">
                      {p.endDate
                        ? new Date(p.endDate).toLocaleDateString()
                        : "–"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={eventUrl(p.eventSlug)}
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

        {data && tab === "settled" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-paper-3/50">
                <tr>
                  <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                    Market
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Entry
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Stake
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Result
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Settled
                  </th>
                </tr>
              </thead>
              <tbody className="divide-rule divide-y">
                {data.recentBets.map((b) => (
                  <tr key={b.conditionId} className="hover:bg-paper-3/40">
                    <td className="px-4 py-2.5">
                      <a
                        href={eventUrl(b.eventSlug)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ink hover:text-accent flex items-center gap-2"
                      >
                        {b.icon && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={b.icon}
                            alt=""
                            className="border-rule h-6 w-6 shrink-0 rounded-md border object-cover"
                          />
                        )}
                        <span
                          className="max-w-[30rem] truncate"
                          title={b.title}
                        >
                          {b.title}
                        </span>
                      </a>
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {b.entryPrice > 0 ? priceCents(b.entryPrice) : "–"}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {formatUsd(b.costUsd)}
                    </td>
                    <td
                      className={cn(
                        "data px-4 py-2.5 text-right font-medium",
                        tone(b.pnlUsd),
                      )}
                    >
                      {formatUsd(b.pnlUsd)}
                    </td>
                    <td className="data text-ink-2 px-4 py-2.5 text-right whitespace-nowrap">
                      {b.at
                        ? relative(new Date(b.at * 1000).toISOString())
                        : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && tab === "trades" && (
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
                    Market
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Price
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Shares
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    USDC
                  </th>
                  <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                    Tx
                  </th>
                </tr>
              </thead>
              <tbody className="divide-rule divide-y">
                {data.activity.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="text-muted px-4 py-10 text-center"
                    >
                      No recent trade.
                    </td>
                  </tr>
                )}
                {data.activity.map((t) => (
                  <tr
                    key={`${t.transactionHash}-${t.timestamp}-${t.outcome}`}
                    className="hover:bg-paper-3/40"
                  >
                    <td className="data text-ink-2 px-4 py-2.5 whitespace-nowrap">
                      {relative(new Date(t.timestamp * 1000).toISOString())}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold uppercase",
                          t.side === "BUY"
                            ? "bg-[#22c55e]/15 text-[#4ade80]"
                            : "bg-[#f43f5e]/10 text-[#fb7185]",
                        )}
                      >
                        {t.side} {t.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <a
                        href={eventUrl(t.eventSlug)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ink hover:text-accent block max-w-[26rem] truncate"
                        title={t.title}
                      >
                        {t.title}
                      </a>
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {priceCents(t.price)}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {Math.round(t.size).toLocaleString()}
                    </td>
                    <td className="data text-ink px-4 py-2.5 text-right">
                      {formatUsd(t.usdcSize, 2)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`https://polygonscan.com/tx/${t.transactionHash}`}
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
      </section>
    </main>
  );
}
