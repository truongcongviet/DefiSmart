"use client";

import { Eye, LoaderCircle, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { watchlist } from "@/lib/local-list";
import { cn } from "@/lib/utils";

interface ActivityEvent {
  type: "open" | "close";
  at: string;
  owner: string;
  position: string;
  pool: string;
  pairName: string;
  protocol: string;
  logo0: string;
  logo1: string;
  depositNative: number;
  valueNative: number;
  pnlNative: number;
  pnlPercentNative: number;
  inRange: boolean | null;
}

interface Activity {
  owner: string;
  generatedAt: string;
  summary: {
    openPositions: number;
    openValueNative: number;
    openPnlNative: number;
    closedInWindow: number;
    realizedPnlNativeInWindow: number;
    uniquePools: number;
  };
  events: ActivityEvent[];
  message?: string;
}

const WALLET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DAYS = 7;

function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
function formatSol(value: number, digits = 2) {
  return `${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} SOL`;
}
function relative(iso: string) {
  const minutes = (Date.now() - Date.parse(iso)) / 60_000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
function tone(value: number) {
  if (value > 0) return "text-[#4ade80]";
  if (value < 0) return "text-[#fb7185]";
  return "text-ink-2";
}

function Logo({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className="border-paper bg-paper-4 text-ink-2 inline-flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-semibold">
        {alt.slice(0, 1).toUpperCase() || "?"}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setBroken(true)}
      referrerPolicy="no-referrer"
      className="border-paper bg-paper-3 h-6 w-6 rounded-full border-2 object-cover"
    />
  );
}

export function WatchlistView() {
  const wallets = watchlist.useList();
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState("");
  const [activity, setActivity] = useState<
    Record<string, Activity | { error: string }>
  >({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (owners: string[]) => {
    if (owners.length === 0) return;
    setLoading(true);
    const results = await Promise.all(
      owners.map(async (owner) => {
        try {
          const response = await fetch(
            `/api/wallets/${owner}/activity?days=${DAYS}`,
          );
          const payload = (await response.json()) as Activity;
          if (!response.ok)
            throw new Error(payload.message || `HTTP ${response.status}`);
          return [owner, payload] as const;
        } catch (error) {
          return [
            owner,
            { error: error instanceof Error ? error.message : "failed" },
          ] as const;
        }
      }),
    );
    setActivity((previous) => {
      const next = { ...previous };
      for (const [owner, value] of results) next[owner] = value;
      return next;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    const missing = wallets.filter((owner) => !activity[owner]);
    if (missing.length > 0) void load(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, load]);

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const owner = input.trim();
    if (!WALLET_REGEX.test(owner)) {
      setInputError("Not a valid Solana address.");
      return;
    }
    setInputError("");
    watchlist.add(owner);
    setInput("");
  }

  const feed = useMemo(() => {
    const events: ActivityEvent[] = [];
    for (const owner of wallets) {
      const entry = activity[owner];
      if (entry && "events" in entry) events.push(...entry.events);
    }
    return events
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 100);
  }, [wallets, activity]);

  return (
    <main className="mx-auto flex w-full max-w-[var(--page-max)] flex-1 flex-col gap-5 px-[var(--page-gutter)] py-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className="border-rule bg-paper-2 inline-flex h-12 w-12 items-center justify-center rounded-xl border"
            >
              <Eye className="text-accent h-5 w-5" />
            </span>
            <h1 className="text-ink text-[28px] font-semibold tracking-tight sm:text-[32px]">
              Watchlist
            </h1>
          </div>
          <p className="text-muted max-w-2xl text-[15px]">
            Positions your watched wallets opened or closed in the last {DAYS}{" "}
            days, straight from on-chain Meteora data. Stored in this browser.
          </p>
        </div>
        <form onSubmit={add} className="flex w-full max-w-md items-start gap-2">
          <div className="flex-1">
            <input
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                if (inputError) setInputError("");
              }}
              placeholder="Add a wallet address"
              className={cn(
                "border-rule bg-paper-2 text-ink placeholder:text-muted h-10 w-full rounded-lg border px-3 font-mono text-sm outline-none",
                inputError && "border-danger",
              )}
            />
            <p className="text-danger min-h-[1.25rem] text-xs leading-5">
              {inputError}
            </p>
          </div>
          <button
            type="submit"
            className="bg-accent text-accent-ink hover:bg-focus inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" /> Watch
          </button>
        </form>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Feed */}
        <section className="border-rule bg-paper-2 rounded-xl border">
          <div className="border-rule flex items-center justify-between border-b px-4 py-3">
            <p className="text-ink text-sm font-medium">Recent activity</p>
            <span className="text-muted inline-flex items-center gap-2 text-xs">
              {loading && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
              {feed.length} events
            </span>
          </div>
          {wallets.length === 0 ? (
            <p className="text-muted px-4 py-12 text-center text-sm">
              No wallets watched yet. Add one above or press the eye icon on the{" "}
              <Link href="/" className="text-accent">
                Smart LP leaderboard
              </Link>
              .
            </p>
          ) : feed.length === 0 && !loading ? (
            <p className="text-muted px-4 py-12 text-center text-sm">
              No positions opened or closed in the last {DAYS} days.
            </p>
          ) : (
            <ul className="divide-rule divide-y">
              {feed.map((event) => (
                <li
                  key={`${event.type}-${event.position}-${event.at}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <span
                    className={cn(
                      "inline-flex h-6 w-14 items-center justify-center rounded-md text-[11px] font-semibold uppercase",
                      event.type === "open"
                        ? "bg-[#22c55e]/15 text-[#4ade80]"
                        : "bg-[#f43f5e]/15 text-[#fb7185]",
                    )}
                  >
                    {event.type}
                  </span>
                  <Link
                    href={`/analysis?owner=${event.owner}`}
                    className="data text-accent hover:text-focus"
                    title={event.owner}
                  >
                    {shortAddress(event.owner)}
                  </Link>
                  <Link
                    href={`/pool/${event.pool}?protocol=${event.protocol === "meteora_damm_v2" ? "damm_v2" : "dlmm"}`}
                    className="text-ink inline-flex items-center gap-2 text-sm font-medium hover:underline"
                  >
                    <span className="flex -space-x-2">
                      <Logo
                        src={event.logo0}
                        alt={event.pairName.split("-")[0] ?? ""}
                      />
                      <Logo
                        src={event.logo1}
                        alt={event.pairName.split("-")[1] ?? ""}
                      />
                    </span>
                    {event.pairName}
                  </Link>
                  <span className="data text-muted text-xs">
                    {event.type === "open"
                      ? `deposit ${formatSol(event.depositNative)}`
                      : `realized`}
                  </span>
                  {event.type === "close" && (
                    <span className={cn("data text-xs", tone(event.pnlNative))}>
                      {event.pnlNative >= 0 ? "+" : ""}
                      {formatSol(event.pnlNative)} (
                      {event.pnlPercentNative.toFixed(2)}%)
                    </span>
                  )}
                  {event.type === "open" && event.inRange !== null && (
                    <span
                      className={cn(
                        "pill h-5 text-[11px]",
                        event.inRange ? "pill-ok" : "pill-warn",
                      )}
                    >
                      {event.inRange ? "In range" : "Out of range"}
                    </span>
                  )}
                  <span className="data text-muted ml-auto text-xs whitespace-nowrap">
                    {relative(event.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Wallets */}
        <section className="border-rule bg-paper-2 h-fit rounded-xl border">
          <div className="border-rule border-b px-4 py-3">
            <p className="text-ink text-sm font-medium">
              Watched wallets · {wallets.length}
            </p>
          </div>
          <ul className="divide-rule divide-y">
            {wallets.map((owner) => {
              const entry = activity[owner];
              const summary =
                entry && "summary" in entry ? entry.summary : null;
              return (
                <li key={owner} className="flex flex-col gap-1.5 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/analysis?owner=${owner}`}
                      className="data text-accent hover:text-focus"
                      title={owner}
                    >
                      {shortAddress(owner)}
                    </Link>
                    <button
                      type="button"
                      onClick={() => watchlist.remove(owner)}
                      aria-label="Remove from watchlist"
                      className="text-muted hover:text-danger inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {summary ? (
                    <p className="data text-muted text-xs">
                      {summary.openPositions} open ·{" "}
                      {formatSol(summary.openValueNative)} · uPnL{" "}
                      <span className={tone(summary.openPnlNative)}>
                        {formatSol(summary.openPnlNative)}
                      </span>
                      {summary.closedInWindow > 0 && (
                        <>
                          {" "}
                          · {DAYS}d realized{" "}
                          <span
                            className={tone(summary.realizedPnlNativeInWindow)}
                          >
                            {formatSol(summary.realizedPnlNativeInWindow)}
                          </span>
                        </>
                      )}
                    </p>
                  ) : entry && "error" in entry ? (
                    <p className="text-danger text-xs">{entry.error}</p>
                  ) : (
                    <p className="text-muted text-xs">loading…</p>
                  )}
                </li>
              );
            })}
            {wallets.length === 0 && (
              <li className="text-muted px-4 py-6 text-center text-xs">
                Empty
              </li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
