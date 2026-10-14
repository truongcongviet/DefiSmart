"use client";

import { Crosshair, ExternalLink, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  FlagPills,
  formatUsd,
  humanMinutes,
  Kpi,
  relative,
  ScoreBadge,
  tone,
} from "@/components/board-ui";
import { TokenMark } from "@/components/token-mark";
import { cn } from "@/lib/utils";

interface TokenRow {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
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
  lastTradeAt: string;
}

interface Result {
  generatedAt: string;
  windowDays: number;
  txScanned: number;
  truncated: boolean;
  oldestScannedAt: string | null;
  summary: {
    score: number;
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    totalPnlUsd: number;
    costUsd: number;
    volumeUsd: number;
    roi: number;
    tokensTraded: number;
    tokensProfitable: number;
    winRate: number;
    trades: number;
    medianHoldMinutes: number | null;
    earlyEntries: number;
    flags: string[];
    tokens: TokenRow[];
  };
  message?: string;
}

/**
 * Token trading of a wallet, straight from its own transactions. Lives on
 * the analysis page next to the LP analysis.
 */
export function WalletTradesPanel({ owner }: { owner: string }) {
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const response = await fetch(`/api/wallets/${target}/trades`);
      const payload = (await response.json()) as Result;
      if (!response.ok)
        throw new Error(payload.message || `HTTP ${response.status}`);
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trades");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (owner) void load(owner);
  }, [owner, load]);

  if (!owner) return null;
  const s = data?.summary;

  return (
    <section className="border-rule bg-paper-2 rounded-xl border">
      <div className="border-rule flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Crosshair className="text-accent h-4 w-4" />
          <h2 className="text-ink text-sm font-semibold">Token trading</h2>
          <span className="text-muted text-xs">
            {data
              ? `${data.txScanned} tx · last ${data.windowDays} days${data.truncated ? " (partial)" : ""}`
              : "swaps from the wallet's own transactions"}
          </span>
        </div>
        {loading && (
          <span className="text-muted inline-flex items-center gap-2 text-xs">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> reading
            transactions…
          </span>
        )}
      </div>

      {error && (
        <p className="px-4 py-6 text-center text-sm text-[#fb7185]">{error}</p>
      )}

      {s && (
        <>
          <div className="divide-rule border-rule grid grid-cols-2 divide-x divide-y border-b sm:grid-cols-4 lg:grid-cols-8 lg:divide-y-0">
            <Kpi label="Score" value={String(s.score)} />
            <Kpi
              label="PnL"
              value={formatUsd(s.totalPnlUsd)}
              valueClassName={tone(s.totalPnlUsd)}
            />
            <Kpi
              label="Realized"
              value={formatUsd(s.realizedPnlUsd)}
              valueClassName={tone(s.realizedPnlUsd)}
            />
            <Kpi
              label="ROI"
              value={`${(s.roi * 100).toFixed(0)}%`}
              valueClassName={tone(s.roi)}
            />
            <Kpi
              label="Win rate"
              value={`${(s.winRate * 100).toFixed(0)}%`}
              hint={`${s.tokensProfitable}/${s.tokensTraded} tokens`}
            />
            <Kpi
              label="Trades"
              value={s.trades.toLocaleString()}
              hint={formatUsd(s.volumeUsd) + " volume"}
            />
            <Kpi
              label="Median hold"
              value={humanMinutes(s.medianHoldMinutes)}
            />
            <Kpi
              label="Early entries"
              value={`${s.earlyEntries}/${s.tokensTraded}`}
            />
          </div>
          {s.flags.length > 0 && (
            <div className="border-rule flex items-center gap-2 border-b px-4 py-2 text-xs">
              <span className="text-muted">Flags</span>
              <FlagPills flags={s.flags} />
            </div>
          )}
          {s.tokens.length === 0 ? (
            <p className="text-muted px-4 py-8 text-center text-sm">
              No token swaps found in the scanned window.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-paper-3/50">
                  <tr>
                    <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                      Token
                    </th>
                    <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                      PnL
                    </th>
                    <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                      Realized
                    </th>
                    <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                      Bought
                    </th>
                    <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                      Trades
                    </th>
                    <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                      Hold
                    </th>
                    <th className="text-muted px-4 py-2.5 text-left text-xs font-medium uppercase">
                      Status
                    </th>
                    <th className="text-muted px-4 py-2.5 text-right text-xs font-medium uppercase">
                      Last
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-rule divide-y">
                  {s.tokens.map((token) => (
                    <tr key={token.mint} className="hover:bg-paper-3/40">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/token/${token.mint}`}
                          className="text-ink hover:text-accent inline-flex items-center gap-2"
                          title={token.name}
                        >
                          <TokenMark
                            token={{
                              symbol: token.symbol,
                              logo: token.logo ?? "",
                            }}
                          />
                          <span className="font-medium">{token.symbol}</span>
                        </Link>
                        <a
                          href={`https://dexscreener.com/solana/${token.mint}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted hover:text-ink ml-2 inline-flex align-middle"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                      <td
                        className={cn(
                          "data px-4 py-2.5 text-right font-medium",
                          tone(token.totalPnlUsd),
                        )}
                      >
                        {formatUsd(token.totalPnlUsd)}
                      </td>
                      <td
                        className={cn(
                          "data px-4 py-2.5 text-right",
                          tone(token.realizedPnlUsd),
                        )}
                      >
                        {formatUsd(token.realizedPnlUsd)}
                      </td>
                      <td className="data text-ink px-4 py-2.5 text-right">
                        {formatUsd(token.costUsd)}
                      </td>
                      <td className="data text-ink px-4 py-2.5 text-right">
                        <span className="text-[#4ade80]">{token.buys}</span>
                        <span className="text-muted"> / </span>
                        <span className="text-[#fb7185]">{token.sells}</span>
                      </td>
                      <td className="data text-ink px-4 py-2.5 text-right">
                        {humanMinutes(token.avgHoldMinutes)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium uppercase",
                            token.closed
                              ? "bg-paper-3 text-muted"
                              : "bg-accent-soft text-accent",
                          )}
                        >
                          {token.closed ? "Exited" : "Holding"}
                        </span>
                      </td>
                      <td className="data text-ink-2 px-4 py-2.5 text-right whitespace-nowrap">
                        {relative(token.lastTradeAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-muted border-rule flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs">
            <span>
              FIFO on the wallet&apos;s own swaps, marked to market with current
              DexScreener prices. Sells with no visible buy are excluded.
            </span>
            <ScoreBadge score={s.score} />
          </div>
        </>
      )}
    </section>
  );
}
