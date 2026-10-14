"use client";

import { Bot, Copy, ExternalLink, LoaderCircle, Power } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { formatUsd, relative } from "@/components/board-ui";
import { cn } from "@/lib/utils";

/**
 * Copy-trading controls for one Polymarket leader: the user's server-side
 * agent wallet, sizing and risk settings, on/off, and the latest jobs.
 */

interface Agent {
  address: string;
  createdAt: string;
}

interface Subscription {
  id: string;
  leaderWallet: string;
  followerWallet: string;
  enabled: boolean;
  createdAt: string;
  settings: {
    ratio?: number;
    maxPerTradeUsd?: number;
    dailyCapUsd?: number;
    maxBuyPrice?: number;
    mode?: "dry-run" | "live";
  };
}

interface Job {
  id: string;
  status: string;
  reason?: string;
  createdAt: string;
  plan?: {
    action: string;
    payload: {
      amount: number;
      amountUsd: number;
      title: string;
      side: string;
      mode: string;
    };
  };
  receipt?: { status: string; transactionId?: string };
}

const STATUS_TONE: Record<string, string> = {
  DRY_RUN: "bg-accent-soft text-accent",
  SUBMITTED: "bg-[#22c55e]/15 text-[#4ade80]",
  CONFIRMED: "bg-[#22c55e]/15 text-[#4ade80]",
  BLOCKED: "bg-[#f59e0b]/15 text-[#fbbf24]",
  SKIPPED: "bg-paper-3 text-muted",
  FAILED: "bg-[#f43f5e]/10 text-[#fb7185]",
};

export function CopyPanel({ leader }: { leader: string }) {
  const [state, setState] = useState<
    "loading" | "unconfigured" | "signed-out" | "ready"
  >("loading");
  const [message, setMessage] = useState("");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [ratio, setRatio] = useState(10);
  const [maxPerTrade, setMaxPerTrade] = useState(25);
  const [dailyCap, setDailyCap] = useState(100);
  const [mode, setMode] = useState<"dry-run" | "live">("dry-run");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/copy/agent");
      const payload = (await response.json()) as {
        agent?: Agent | null;
        message?: string;
        configured?: boolean;
      };
      if (response.status === 503) {
        setState("unconfigured");
        setMessage(payload.message ?? "");
        return;
      }
      if (response.status === 401) {
        setState("signed-out");
        return;
      }
      if (!response.ok)
        throw new Error(payload.message || `HTTP ${response.status}`);
      setAgent(payload.agent ?? null);
      const subs = (await (await fetch("/api/copy/subscriptions")).json()) as {
        subscriptions?: Subscription[];
      };
      const mine =
        subs.subscriptions?.find(
          (s) => s.leaderWallet === leader.toLowerCase(),
        ) ?? null;
      setSubscription(mine);
      if (mine) {
        setRatio(Math.round((mine.settings.ratio ?? 0.1) * 100));
        setMaxPerTrade(mine.settings.maxPerTradeUsd ?? 25);
        setDailyCap(mine.settings.dailyCapUsd ?? 100);
        setMode(mine.settings.mode ?? "dry-run");
        const jobsPayload = (await (
          await fetch(
            `/api/copy/jobs?subscription=${encodeURIComponent(mine.id)}`,
          )
        ).json()) as { jobs?: Job[] };
        setJobs(jobsPayload.jobs ?? []);
      }
      setState("ready");
    } catch (error) {
      setState("ready");
      setMessage(
        error instanceof Error ? error.message : "Failed to load copy settings",
      );
    }
  }, [leader]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createAgent() {
    setBusy(true);
    try {
      const response = await fetch("/api/copy/agent", { method: "POST" });
      const payload = (await response.json()) as {
        agent?: Agent;
        message?: string;
      };
      if (!response.ok)
        throw new Error(payload.message || `HTTP ${response.status}`);
      setAgent(payload.agent ?? null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to create agent",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save(enabled: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/copy/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leaderWallet: leader,
          enabled,
          settings: {
            ratio: ratio / 100,
            maxPerTradeUsd: maxPerTrade,
            dailyCapUsd: dailyCap,
            mode,
          },
        }),
      });
      const payload = (await response.json()) as {
        subscription?: Subscription;
        message?: string;
      };
      if (!response.ok)
        throw new Error(payload.message || `HTTP ${response.status}`);
      setSubscription(payload.subscription ?? null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function copyAddress() {
    if (!agent) return;
    try {
      await navigator.clipboard.writeText(agent.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  }

  const input =
    "border-rule bg-paper text-ink data h-8 w-24 rounded-lg border px-2 text-right text-sm outline-none";

  return (
    <section className="border-rule bg-paper-2 rounded-xl border">
      <div className="border-rule flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <span className="flex items-center gap-2">
          <Bot className="text-accent h-4 w-4" />
          <h2 className="text-ink text-sm font-semibold">Copy this trader</h2>
          {subscription && (
            <span
              className={cn(
                "inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium uppercase",
                subscription.enabled
                  ? "bg-[#22c55e]/15 text-[#4ade80]"
                  : "bg-paper-3 text-muted",
              )}
            >
              {subscription.enabled
                ? subscription.settings.mode === "live"
                  ? "live"
                  : "dry-run"
                : "paused"}
            </span>
          )}
        </span>
        {state === "ready" && agent && (
          <span className="text-muted flex items-center gap-2 text-xs">
            Agent wallet
            <button
              type="button"
              onClick={copyAddress}
              className="data text-ink hover:text-accent inline-flex items-center gap-1"
              title={agent.address}
            >
              {agent.address.slice(0, 6)}…{agent.address.slice(-4)}{" "}
              <Copy className="h-3 w-3" />
              {copied && <span className="text-accent">copied</span>}
            </button>
            <a
              href={`https://polygonscan.com/address/${agent.address}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink inline-flex"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </span>
        )}
      </div>

      <div className="px-4 py-3 text-sm">
        {state === "loading" && (
          <span className="text-muted inline-flex items-center gap-2 text-xs">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> loading…
          </span>
        )}
        {state === "unconfigured" && (
          <p className="text-muted text-xs">
            {message || "Copy trading is not configured on this server."}
          </p>
        )}
        {state === "signed-out" && (
          <p className="text-muted text-xs">
            Sign in with the Connect wallet button to set up copy trading.
          </p>
        )}

        {state === "ready" && !agent && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted text-xs">
              Create a Polygon agent wallet on the server. Fund it with USDC.e
              plus a little POL, then enable copying.
            </p>
            <button
              type="button"
              onClick={createAgent}
              disabled={busy}
              className="bg-accent text-accent-ink hover:bg-focus inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium disabled:opacity-50"
            >
              {busy ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Bot className="h-3.5 w-3.5" />
              )}{" "}
              Create agent wallet
            </button>
          </div>
        )}

        {state === "ready" && agent && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-ink-2 flex flex-col gap-1 text-xs">
                Copy ratio %
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={ratio}
                  onChange={(e) => setRatio(Number(e.target.value))}
                  className={input}
                />
              </label>
              <label className="text-ink-2 flex flex-col gap-1 text-xs">
                Max per trade $
                <input
                  type="number"
                  min={1}
                  value={maxPerTrade}
                  onChange={(e) => setMaxPerTrade(Number(e.target.value))}
                  className={input}
                />
              </label>
              <label className="text-ink-2 flex flex-col gap-1 text-xs">
                Daily cap $
                <input
                  type="number"
                  min={1}
                  value={dailyCap}
                  onChange={(e) => setDailyCap(Number(e.target.value))}
                  className={input}
                />
              </label>
              <label className="text-ink-2 flex flex-col gap-1 text-xs">
                Mode
                <select
                  value={mode}
                  onChange={(e) =>
                    setMode(e.target.value as "dry-run" | "live")
                  }
                  className="border-rule bg-paper text-ink h-8 rounded-lg border px-2 text-sm outline-none"
                >
                  <option value="dry-run">Dry run (log only)</option>
                  <option value="live">Live orders</option>
                </select>
              </label>
              <div className="ml-auto flex items-center gap-2">
                {subscription?.enabled && (
                  <button
                    type="button"
                    onClick={() => save(false)}
                    disabled={busy}
                    className="border-rule text-ink-2 hover:text-ink inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs disabled:opacity-50"
                  >
                    <Power className="h-3.5 w-3.5" /> Pause
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => save(true)}
                  disabled={busy}
                  className="bg-accent text-accent-ink hover:bg-focus inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium disabled:opacity-50"
                >
                  {busy ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Power className="h-3.5 w-3.5" />
                  )}
                  {subscription?.enabled ? "Save" : "Enable copy"}
                </button>
              </div>
            </div>
            <p className="text-muted text-xs">
              Each leader BUY is copied at {ratio}% of its USDC size, at most{" "}
              {formatUsd(maxPerTrade)} per trade and {formatUsd(dailyCap)} per
              day; buys above 95¢ are skipped. SELLs copy the same fraction of
              your holding. Orders are fill-or-kill market orders from the agent
              wallet. Mode &ldquo;live&rdquo; posts real orders; keep dry-run until the
              agent is funded and approved.
            </p>
            {message && <p className="text-xs text-[#fb7185]">{message}</p>}

            {subscription && (
              <div className="border-rule rounded-lg border">
                <div className="border-rule text-muted flex items-center justify-between border-b px-3 py-2 text-xs">
                  <span>Recent copy jobs</span>
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="hover:text-ink"
                  >
                    refresh
                  </button>
                </div>
                {jobs.length === 0 ? (
                  <p className="text-muted px-3 py-4 text-center text-xs">
                    No job yet. The worker records one for every leader fill.
                  </p>
                ) : (
                  <ul className="divide-rule divide-y">
                    {jobs.slice(0, 10).map((job) => (
                      <li
                        key={job.id}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium uppercase",
                              STATUS_TONE[job.status] ??
                                "bg-paper-3 text-muted",
                            )}
                          >
                            {job.status.replace("_", " ")}
                          </span>
                          <span className="text-ink truncate">
                            {job.plan
                              ? `${job.plan.payload.side} ${job.plan.payload.side === "BUY" ? formatUsd(job.plan.payload.amount) : `${job.plan.payload.amount} sh`} · ${job.plan.payload.title}`
                              : (job.reason ?? "–")}
                          </span>
                        </span>
                        <span className="text-muted shrink-0">
                          {relative(job.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
