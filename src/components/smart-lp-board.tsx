"use client";

import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Eye,
  EyeOff,
  LoaderCircle,
  RefreshCw,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { watchlist } from "@/lib/local-list";
import { cn } from "@/lib/utils";

interface BoardPool {
  address: string;
  name: string;
  protocol: string;
  pnlNative: number;
  openPositions: number;
}

interface BoardWallet {
  owner: string;
  score: number;
  pnlUsd: number;
  pnlNative: number;
  feeNative: number;
  depositNative: number;
  positions: number;
  openPositions: number;
  closedPositions: number;
  winRate: number;
  avgAgeHours: number;
  poolCount: number;
  pools: BoardPool[];
  lastActivity: string | null;
}

interface Board {
  generatedAt: string;
  poolsRequested: number;
  poolsScanned: number;
  walletsSeen: number;
  wallets: BoardWallet[];
  warnings: string[];
  message?: string;
}

type SortKey =
  | "score"
  | "pnlNative"
  | "feeNative"
  | "positions"
  | "winRate"
  | "poolCount"
  | "lastActivity";

function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatSol(value: number, digits = 2) {
  const abs = Math.abs(value);
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}k`;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function humanAge(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return "–";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes`;
  if (hours < 24) return `${Math.round(hours)} hours`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)} days`;
  return `${Math.round(days / 30)} months`;
}

function relative(iso: string | null) {
  if (!iso) return "–";
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function tone(value: number) {
  if (value > 0) return "text-[#4ade80]";
  if (value < 0) return "text-[#fb7185]";
  return "text-ink-2";
}

function scoreTone(score: number) {
  if (score >= 70) return "bg-[#22c55e]/15 text-[#4ade80]";
  if (score >= 45) return "bg-accent-soft text-accent";
  return "bg-paper-3 text-muted";
}

function Th({
  label,
  sortKey,
  active,
  direction,
  onSort,
  align = "right",
}: {
  label: string;
  sortKey?: SortKey;
  active: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const sortable = Boolean(sortKey);
  const isActive = sortable && active === sortKey;
  const Icon = !isActive
    ? ChevronsUpDown
    : direction === "asc"
      ? ChevronUp
      : ChevronDown;
  return (
    <th
      className={cn(
        "text-muted px-4 py-2.5 text-xs font-medium tracking-wide whitespace-nowrap uppercase",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort(sortKey as SortKey)}
          className={cn(
            "hover:text-ink inline-flex items-center gap-1 uppercase transition-colors",
            isActive && "text-ink",
            align === "right" && "flex-row-reverse",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
      <span className="text-muted text-xs">{label}</span>
      <span className="data text-ink text-[15px] font-medium">{value}</span>
      {hint && <span className="text-muted text-[11px]">{hint}</span>}
    </div>
  );
}

export function SmartLpBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [minWin, setMinWin] = useState(0);
  const [minPositions, setMinPositions] = useState(3);
  const [profitableOnly, setProfitableOnly] = useState(true);
  const watched = watchlist.useList();
  const watchedSet = useMemo(() => new Set(watched), [watched]);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/leaderboard/smart-lp${refresh ? "?refresh=1" : ""}`,
      );
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!board) return [];
    const filtered = board.wallets.filter((wallet) => {
      if (wallet.positions < minPositions) return false;
      if (wallet.winRate < minWin) return false;
      if (profitableOnly && wallet.pnlNative <= 0) return false;
      return true;
    });
    const sign = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "lastActivity") {
        return (
          sign *
          (Date.parse(a.lastActivity ?? "") - Date.parse(b.lastActivity ?? ""))
        );
      }
      return sign * (a[sortKey] - b[sortKey]);
    });
  }, [board, minPositions, minWin, profitableOnly, sortKey, sortDir]);

  function onSort(key: SortKey) {
    if (key === sortKey) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const totals = useMemo(() => {
    if (!board) return null;
    const profitable = board.wallets.filter((w) => w.pnlNative > 0).length;
    return {
      profitable,
      pnl: board.wallets.reduce((sum, w) => sum + w.pnlNative, 0),
      fees: board.wallets.reduce((sum, w) => sum + w.feeNative, 0),
    };
  }, [board]);

  return (
    <main className="mx-auto flex w-full max-w-[var(--page-max)] flex-1 flex-col gap-5 px-[var(--page-gutter)] py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className="border-rule bg-paper-2 inline-flex h-12 w-12 items-center justify-center rounded-xl border"
            >
              <Trophy className="text-accent h-5 w-5" />
            </span>
            <h1 className="text-ink text-[28px] font-semibold tracking-tight sm:text-[32px]">
              Smart LP wallets
            </h1>
          </div>
          <p className="text-muted max-w-2xl text-[15px]">
            Wallets providing liquidity in Meteora&apos;s top pools right now,
            ranked by realized results across those pools. Computed from
            on-chain data, refreshed hourly. Watch a wallet to follow its next
            moves.
          </p>
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

      <section className="border-rule bg-paper-2 divide-rule grid grid-cols-2 divide-x divide-y rounded-xl border sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        <Kpi
          label="Pools scanned"
          value={board ? `${board.poolsScanned}/${board.poolsRequested}` : "–"}
          hint="Top 24h, quality-filtered"
        />
        <Kpi
          label="Wallets seen"
          value={board ? board.walletsSeen.toLocaleString() : "–"}
        />
        <Kpi
          label="Ranked"
          value={board ? board.wallets.length.toLocaleString() : "–"}
          hint="≥ 2 positions"
        />
        <Kpi
          label="In profit"
          value={
            totals && board
              ? `${Math.round((totals.profitable / Math.max(1, board.wallets.length)) * 100)}%`
              : "–"
          }
        />
        <Kpi
          label="Net PnL (ranked)"
          value={totals ? `${formatSol(totals.pnl)} SOL` : "–"}
        />
        <Kpi
          label="Updated"
          value={board ? relative(board.generatedAt) : "–"}
          hint={
            board ? new Date(board.generatedAt).toLocaleString() : undefined
          }
        />
      </section>

      <section className="border-rule bg-paper-2 rounded-xl border">
        <div className="border-rule flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={profitableOnly}
              onChange={(e) => setProfitableOnly(e.target.checked)}
              className="accent-accent h-4 w-4"
            />
            Profitable only
          </label>
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            Min win rate
            <select
              value={minWin}
              onChange={(e) => setMinWin(Number(e.target.value))}
              className="border-rule bg-paper text-ink h-8 rounded-lg border px-2 text-sm outline-none"
            >
              <option value={0}>any</option>
              <option value={0.5}>50%</option>
              <option value={0.6}>60%</option>
              <option value={0.7}>70%</option>
              <option value={0.8}>80%</option>
            </select>
          </label>
          <label className="text-ink-2 inline-flex h-9 items-center gap-2 text-sm">
            Min positions
            <select
              value={minPositions}
              onChange={(e) => setMinPositions(Number(e.target.value))}
              className="border-rule bg-paper text-ink h-8 rounded-lg border px-2 text-sm outline-none"
            >
              {[2, 3, 5, 10, 20].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="text-muted ml-auto text-xs">
            {rows.length} wallets
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-paper-3/50">
              <tr>
                <th className="text-muted w-12 px-4 py-2.5 text-left text-xs font-medium uppercase">
                  #
                </th>
                <Th
                  label="Owner"
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
                  label="Total PnL"
                  sortKey="pnlNative"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Total Fee"
                  sortKey="feeNative"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Total LP"
                  sortKey="positions"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Win Rate"
                  sortKey="winRate"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
                <Th
                  label="Pools"
                  sortKey="poolCount"
                  active={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                  align="left"
                />
                <Th
                  label="Last Active"
                  sortKey="lastActivity"
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
                Array.from({ length: 10 }).map((_, index) => (
                  <tr key={index}>
                    <td colSpan={10} className="px-4 py-3.5">
                      <div
                        className="bg-paper-3 h-4 animate-pulse rounded"
                        style={{ width: `${45 + ((index * 19) % 50)}%` }}
                      />
                    </td>
                  </tr>
                ))}
              {loading && !board && (
                <tr>
                  <td
                    colSpan={10}
                    className="text-muted px-4 py-3 text-center text-xs"
                  >
                    First scan reads ~30 pools on-chain and can take up to a
                    minute…
                  </td>
                </tr>
              )}
              {error && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-10 text-center text-sm text-[#fb7185]"
                  >
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="text-muted px-4 py-10 text-center"
                  >
                    No wallet matches these filters.
                  </td>
                </tr>
              )}
              {rows.map((wallet, index) => {
                const isWatched = watchedSet.has(wallet.owner);
                return (
                  <tr
                    key={wallet.owner}
                    className="hover:bg-paper-3/40 transition-colors"
                  >
                    <td className="data text-muted px-4 py-3">{index + 1}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/analysis?owner=${wallet.owner}`}
                        className="data text-accent hover:text-focus underline decoration-dotted underline-offset-4"
                        title={wallet.owner}
                      >
                        {shortAddress(wallet.owner)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={cn(
                          "data inline-flex h-6 min-w-10 items-center justify-center rounded-md px-2 text-xs font-semibold",
                          scoreTone(wallet.score),
                        )}
                      >
                        {wallet.score}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "data px-4 py-3 text-right font-medium",
                        tone(wallet.pnlNative),
                      )}
                    >
                      {formatSol(wallet.pnlNative)} SOL
                    </td>
                    <td className="data text-ink px-4 py-3 text-right">
                      {formatSol(wallet.feeNative)} SOL
                    </td>
                    <td className="data text-ink px-4 py-3 text-right">
                      {wallet.positions}
                      <span className="text-muted">
                        {" "}
                        · {wallet.openPositions} open
                      </span>
                    </td>
                    <td
                      className={cn(
                        "data px-4 py-3 text-right",
                        wallet.closedPositions === 0
                          ? "text-muted"
                          : wallet.winRate >= 0.5
                            ? "text-[#4ade80]"
                            : "text-[#fb7185]",
                      )}
                    >
                      {wallet.closedPositions === 0
                        ? "–"
                        : `${(wallet.winRate * 100).toFixed(0)}%`}
                      <span className="text-muted">
                        {" "}
                        · {wallet.closedPositions}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex max-w-[22rem] flex-wrap gap-1">
                        {wallet.pools.slice(0, 3).map((pool) => (
                          <Link
                            key={pool.address}
                            href={`/pool/${pool.address}?protocol=${pool.protocol === "meteora_damm_v2" ? "damm_v2" : "dlmm"}`}
                            className={cn(
                              "inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] transition-colors",
                              pool.pnlNative >= 0
                                ? "bg-[#22c55e]/10 text-[#4ade80] hover:bg-[#22c55e]/20"
                                : "bg-[#f43f5e]/10 text-[#fb7185] hover:bg-[#f43f5e]/20",
                            )}
                            title={`${pool.name}: ${formatSol(pool.pnlNative)} SOL`}
                          >
                            {pool.name}
                          </Link>
                        ))}
                        {wallet.poolCount > 3 && (
                          <span className="text-muted inline-flex h-6 items-center text-[11px]">
                            +{wallet.poolCount - 3}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="data text-ink-2 px-4 py-3 text-right whitespace-nowrap">
                      {relative(wallet.lastActivity)}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => watchlist.toggle(wallet.owner)}
                        aria-pressed={isWatched}
                        aria-label={
                          isWatched ? "Stop watching" : "Watch wallet"
                        }
                        title={isWatched ? "Stop watching" : "Watch wallet"}
                        className={cn(
                          "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                          isWatched
                            ? "bg-accent-soft text-accent"
                            : "text-muted hover:bg-paper-3 hover:text-ink",
                        )}
                      >
                        {isWatched ? (
                          <Eye className="h-4 w-4" />
                        ) : (
                          <EyeOff className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {board && (
          <div className="text-muted border-rule flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-xs">
            <span>
              Score = 35% win rate (confidence-weighted) + 35% PnL + 15% fees +
              15% pool breadth · avg hold{" "}
              {humanAge(
                rows.length
                  ? rows.reduce((s, w) => s + w.avgAgeHours, 0) / rows.length
                  : 0,
              )}
            </span>
            {board.warnings.length > 0 && (
              <span>{board.warnings.length} pool(s) skipped</span>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
