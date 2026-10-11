"use client";

import {
  Activity,
  Bookmark,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Database,
  Eye,
  Filter,
  Gauge,
  Info,
  Layers3,
  LockKeyhole,
  Medal,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  UserRoundSearch,
  WalletCards,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  RankedTrader,
  TraderLeaderboardResponse,
  TraderProviderStatus,
  TraderWindow,
} from "@/lib/traders/types";
import { cn } from "@/lib/utils";

type DashboardView = "discover" | "following" | "activity";
type StrategyFilter = "All" | RankedTrader["strategy"];
type SortOption = "copy-score" | "pnl" | "roi" | "drawdown";

const WINDOWS: Array<{ value: TraderWindow; label: string }> = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "ALL" },
];

const STRATEGIES: StrategyFilter[] = ["All", "Meme", "Spot", "LP", "Mixed"];

const AVATAR_TONES = [
  "from-emerald-300 to-cyan-600",
  "from-violet-300 to-indigo-600",
  "from-orange-300 to-rose-600",
  "from-cyan-300 to-blue-600",
  "from-lime-300 to-emerald-600",
  "from-fuchsia-300 to-purple-600",
];

function formatUsd(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);

  if (absolute >= 1_000_000_000) {
    return `${sign}$${(absolute / 1_000_000_000).toFixed(1)}B`;
  }

  if (absolute >= 1_000_000) {
    return `${sign}$${(absolute / 1_000_000).toFixed(2)}M`;
  }

  if (absolute >= 1_000) {
    return `${sign}$${(absolute / 1_000).toFixed(1)}K`;
  }

  return `${sign}$${absolute.toFixed(0)}`;
}

function formatCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return String(value);
}

function formatPercent(value: number | null, signed = false) {
  if (value === null) {
    return "—";
  }

  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatHold(minutes: number | null) {
  if (minutes === null) {
    return "—";
  }

  if (minutes >= 1_440) {
    return `${Math.round(minutes / 1_440)}d`;
  }

  if (minutes >= 60) {
    return `${Math.round(minutes / 60)}h`;
  }

  return `${minutes}m`;
}

function shortAddress(address: string | null) {
  if (!address) {
    return "Wallet unavailable";
  }

  return `${address.slice(0, 5)}...${address.slice(-5)}`;
}

function statusTone(status: TraderProviderStatus["status"]) {
  if (status === "connected" || status === "safe") {
    return "bg-emerald-400";
  }

  if (status === "error") {
    return "bg-rose-400";
  }

  if (status === "restricted") {
    return "bg-amber-400";
  }

  return "bg-cyan-400";
}

function riskTone(risk: RankedTrader["risk"]) {
  if (risk === "Low") {
    return "border-emerald-400/20 bg-emerald-400/8 text-emerald-300";
  }

  if (risk === "High") {
    return "border-rose-400/20 bg-rose-400/8 text-rose-300";
  }

  return "border-amber-400/20 bg-amber-400/8 text-amber-300";
}

export function CopyTradeDashboard({
  initialData,
}: {
  initialData: TraderLeaderboardResponse;
}) {
  const [leaderboard, setLeaderboard] = useState(initialData);
  const [window, setWindow] = useState<TraderWindow>(initialData.window);
  const [view, setView] = useState<DashboardView>("discover");
  const [strategy, setStrategy] = useState<StrategyFilter>("All");
  const [sort, setSort] = useState<SortOption>("copy-score");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(
    initialData.traders[0]?.id ?? "",
  );
  const [following, setFollowing] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [requestError, setRequestError] = useState(false);
  const [draftCreated, setDraftCreated] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/traders/leaderboard?window=${window}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Leaderboard request failed with ${response.status}`);
        }

        return (await response.json()) as TraderLeaderboardResponse;
      })
      .then((data) => {
        setLeaderboard(data);
        setSelectedId((current) =>
          data.traders.some((trader) => trader.id === current)
            ? current
            : (data.traders[0]?.id ?? ""),
        );
        setRequestError(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setRequestError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [refreshNonce, window]);

  const displayTraders = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    let traders = leaderboard.traders.filter((trader) => {
      if (view === "following" && !following.has(trader.id)) {
        return false;
      }

      if (strategy !== "All" && trader.strategy !== strategy) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [
        trader.handle,
        trader.displayName,
        trader.wallets.solana ?? "",
        ...trader.topTokens,
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
    });

    traders = [...traders].sort((left, right) => {
      if (sort === "pnl") {
        return right.performance.pnlUsd - left.performance.pnlUsd;
      }

      if (sort === "roi") {
        return (
          (right.performance.roiPct ?? -Infinity) -
          (left.performance.roiPct ?? -Infinity)
        );
      }

      if (sort === "drawdown") {
        return (
          (left.performance.maxDrawdownPct ?? Infinity) -
          (right.performance.maxDrawdownPct ?? Infinity)
        );
      }

      return (right.copyScore ?? -Infinity) - (left.copyScore ?? -Infinity);
    });

    return traders;
  }, [following, leaderboard.traders, search, sort, strategy, view]);

  const selectedTrader =
    leaderboard.traders.find((trader) => trader.id === selectedId) ??
    displayTraders[0] ??
    null;

  const metrics = useMemo(() => {
    const verified = leaderboard.traders.filter(
      (trader) => trader.verification === "onchain-verified",
    ).length;
    const scoreRows = leaderboard.traders.filter(
      (trader) => trader.copyScore !== null,
    );
    const scoreTotal = scoreRows.reduce(
      (total, trader) => total + (trader.copyScore ?? 0),
      0,
    );

    return {
      totalPnl: leaderboard.traders.reduce(
        (total, trader) => total + trader.performance.pnlUsd,
        0,
      ),
      verified,
      avgScore: scoreRows.length
        ? Math.round(scoreTotal / scoreRows.length)
        : null,
      trades: leaderboard.traders.reduce(
        (total, trader) => total + trader.performance.trades,
        0,
      ),
    };
  }, [leaderboard.traders]);

  function handleWindowChange(nextWindow: TraderWindow) {
    if (nextWindow === window) {
      return;
    }

    setWindow(nextWindow);
    setLoading(true);
    setDraftCreated(false);
  }

  function handleRefresh() {
    setLoading(true);
    setRefreshNonce((value) => value + 1);
  }

  function toggleFollow(id: string) {
    setFollowing((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-[1560px] flex-1 flex-col gap-5 px-3 py-5 sm:px-5 lg:px-7">
      <section className="relative overflow-hidden rounded-[26px] border border-white/8 bg-[#0c121d] px-5 py-6 shadow-[0_30px_90px_rgba(0,0,0,0.32)] sm:px-7 sm:py-8">
        <div className="pointer-events-none absolute -top-32 right-[-4rem] h-80 w-80 rounded-full bg-emerald-500/15 blur-[90px]" />
        <div className="pointer-events-none absolute -bottom-40 left-1/3 h-72 w-72 rounded-full bg-cyan-500/10 blur-[90px]" />

        <div className="relative grid items-end gap-7 xl:grid-cols-[minmax(0,1fr)_520px]">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/7 px-3 py-1.5 text-[11px] font-semibold tracking-[0.16em] text-emerald-300 uppercase">
              <Radio className="h-3.5 w-3.5" />
              On-chain trader intelligence
            </div>
            <h1 className="max-w-3xl text-3xl leading-[1.08] font-semibold tracking-[-0.04em] text-white sm:text-5xl">
              Copy the edge.
              <span className="block bg-gradient-to-r from-emerald-300 via-cyan-300 to-sky-400 bg-clip-text text-transparent">
                Keep the control.
              </span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">
              Discover high-performing wallets, verify every signal on-chain,
              then simulate risk before capital ever moves.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  document.getElementById("trader-board")?.scrollIntoView({
                    behavior: "smooth",
                  });
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-[#06110d] transition hover:bg-emerald-300"
              >
                Explore top traders
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
                <LockKeyhole className="h-4 w-4 text-emerald-400" />
                Observe-only. No autonomous execution.
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard
              icon={CircleDollarSign}
              label={`${window === "all" ? "All-time" : window.toUpperCase()} net PnL`}
              value={formatUsd(metrics.totalPnl)}
              detail={`${formatCount(metrics.trades)} observed trades`}
              tone="emerald"
            />
            <MetricCard
              icon={ShieldCheck}
              label="Verified wallets"
              value={`${metrics.verified}/${leaderboard.traders.length}`}
              detail={
                leaderboard.mode === "preview"
                  ? "Preview verification state"
                  : "Independent check pending"
              }
              tone="cyan"
            />
            <MetricCard
              icon={Gauge}
              label="Avg copy score"
              value={
                metrics.avgScore === null
                  ? "Pending"
                  : `${metrics.avgScore}/100`
              }
              detail="Risk + consistency + liquidity"
              tone="violet"
            />
            <MetricCard
              icon={UserRoundSearch}
              label="Trader universe"
              value={formatCount(leaderboard.traders.length)}
              detail={
                leaderboard.mode === "live"
                  ? "Live provider rows"
                  : "Preview profiles"
              }
              tone="orange"
            />
          </div>
        </div>
      </section>

      <section className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {leaderboard.providers.map((provider) => (
          <article
            key={provider.id}
            className="flex items-center gap-3 rounded-2xl border border-white/7 bg-[#0b111a]/85 px-4 py-3"
          >
            <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
              <span
                className={cn(
                  "absolute inline-flex h-full w-full animate-ping rounded-full opacity-40",
                  statusTone(provider.status),
                )}
              />
              <span
                className={cn(
                  "relative inline-flex h-2.5 w-2.5 rounded-full",
                  statusTone(provider.status),
                )}
              />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-zinc-200">
                {provider.label}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                {provider.detail}
              </p>
            </div>
          </article>
        ))}
      </section>

      <section
        className={cn(
          "flex items-start gap-3 rounded-2xl border px-4 py-3 text-xs leading-5",
          leaderboard.mode === "preview"
            ? "border-amber-400/15 bg-amber-400/5 text-amber-100"
            : "border-cyan-400/15 bg-cyan-400/5 text-cyan-100",
        )}
      >
        {leaderboard.mode === "preview" ? (
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        ) : (
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
        )}
        <div className="flex-1">
          <span className="font-semibold">
            {leaderboard.mode === "preview"
              ? "Preview mode."
              : "Live discovery."}
          </span>{" "}
          {leaderboard.notice}
          {requestError &&
            " Không thể refresh API; dữ liệu gần nhất vẫn được giữ lại."}
        </div>
      </section>

      <section
        id="trader-board"
        className="overflow-hidden rounded-[24px] border border-white/8 bg-[#0a1019]/95 shadow-[0_24px_70px_rgba(0,0,0,0.24)]"
      >
        <div className="border-b border-white/7 px-4 pt-4 sm:px-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-1 overflow-x-auto">
              <ViewTab
                active={view === "discover"}
                icon={Sparkles}
                label="Discover"
                onClick={() => setView("discover")}
              />
              <ViewTab
                active={view === "following"}
                icon={Bookmark}
                label={`Following ${following.size ? `(${following.size})` : ""}`}
                onClick={() => setView("following")}
              />
              <ViewTab
                active={view === "activity"}
                icon={Activity}
                label="Live activity"
                onClick={() => setView("activity")}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pb-4 xl:pb-0">
              <div className="inline-flex rounded-xl border border-white/8 bg-[#0d1521] p-1">
                {WINDOWS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => handleWindowChange(item.value)}
                    className={cn(
                      "rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition",
                      window === item.value
                        ? "bg-zinc-100 text-zinc-950"
                        : "text-zinc-500 hover:text-zinc-200",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleRefresh}
                aria-label="Refresh leaderboard"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-[#0d1521] text-zinc-400 transition hover:text-white"
              >
                <RefreshCw
                  className={cn("h-4 w-4", loading && "animate-spin")}
                />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/5 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-1 overflow-x-auto">
              {STRATEGIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStrategy(item)}
                  className={cn(
                    "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                    strategy === item
                      ? "bg-emerald-400/12 text-emerald-300"
                      : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative block">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Trader, wallet or token"
                  className="h-9 w-full rounded-xl border border-white/8 bg-[#0d1521] pr-3 pl-9 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-emerald-400/40 sm:w-56"
                />
              </label>
              <label className="relative">
                <Filter className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                <select
                  value={sort}
                  onChange={(event) =>
                    setSort(event.target.value as SortOption)
                  }
                  className="h-9 w-full appearance-none rounded-xl border border-white/8 bg-[#0d1521] pr-8 pl-9 text-xs text-zinc-300 outline-none sm:w-40"
                >
                  <option value="copy-score">Copy score</option>
                  <option value="pnl">Highest PnL</option>
                  <option value="roi">Highest ROI</option>
                  <option value="drawdown">Lowest drawdown</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        {view === "activity" ? (
          <ActivityPlaceholder />
        ) : (
          <div className="grid xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left text-xs">
                <thead className="border-b border-white/7 bg-[#0c131f] text-[10px] tracking-[0.12em] text-zinc-600 uppercase">
                  <tr>
                    <th className="w-10 px-4 py-3">#</th>
                    <th className="px-3 py-3">Trader</th>
                    <th className="px-3 py-3 text-right">PnL</th>
                    <th className="px-3 py-3 text-right">ROI</th>
                    <th className="px-3 py-3 text-right">Win rate</th>
                    <th className="px-3 py-3 text-right">Max DD</th>
                    <th className="px-3 py-3 text-right">Trades</th>
                    <th className="px-3 py-3 text-right">Avg hold</th>
                    <th className="px-3 py-3 text-center">Copy score</th>
                    <th className="px-3 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {displayTraders.map((trader, index) => (
                    <TraderRow
                      key={trader.id}
                      trader={trader}
                      position={index + 1}
                      selected={selectedTrader?.id === trader.id}
                      followed={following.has(trader.id)}
                      onSelect={() => {
                        setSelectedId(trader.id);
                        setDraftCreated(false);
                      }}
                      onFollow={() => toggleFollow(trader.id)}
                    />
                  ))}
                </tbody>
              </table>

              {displayTraders.length === 0 && (
                <div className="flex min-h-72 flex-col items-center justify-center px-5 text-center">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-zinc-500">
                    <UserRoundSearch className="h-5 w-5" />
                  </span>
                  <p className="mt-4 text-sm font-semibold text-zinc-300">
                    {view === "following"
                      ? "Chưa follow trader nào"
                      : "Không tìm thấy trader"}
                  </p>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-600">
                    {view === "following"
                      ? "Đánh dấu trader trong tab Discover để tạo watchlist riêng."
                      : "Thử thay đổi strategy hoặc từ khoá tìm kiếm."}
                  </p>
                </div>
              )}
            </div>

            <CopySetupPanel
              trader={selectedTrader}
              draftCreated={draftCreated}
              onCreateDraft={() => setDraftCreated(true)}
            />
          </div>
        )}
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <PrincipleCard
          icon={Database}
          number="01"
          title="Discover broadly"
          description="FOMO, GMGN partnership và wallet import chỉ tạo candidate list — chưa phải sự thật cuối cùng."
        />
        <PrincipleCard
          icon={ShieldCheck}
          number="02"
          title="Verify independently"
          description="Tự tính PnL, drawdown, transfer và thanh khoản từ lịch sử on-chain trước khi xếp hạng."
        />
        <PrincipleCard
          icon={Bot}
          number="03"
          title="Execute with limits"
          description="Copy theo tỷ lệ, giới hạn slippage/daily loss và luôn có kill switch ở ví agent."
        />
      </section>
    </main>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  tone: "emerald" | "cyan" | "violet" | "orange";
}) {
  const toneClasses = {
    emerald: "bg-emerald-400/10 text-emerald-300",
    cyan: "bg-cyan-400/10 text-cyan-300",
    violet: "bg-violet-400/10 text-violet-300",
    orange: "bg-orange-400/10 text-orange-300",
  };

  return (
    <article className="rounded-2xl border border-white/8 bg-white/[0.025] p-4 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
          {label}
        </p>
        <span className={cn("rounded-lg p-2", toneClasses[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold tracking-tight text-white">
        {value}
      </p>
      <p className="mt-1 text-[11px] text-zinc-600">{detail}</p>
    </article>
  );
}

function ViewTab({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Activity;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-semibold transition",
        active
          ? "border-emerald-400 text-zinc-100"
          : "border-transparent text-zinc-600 hover:text-zinc-300",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function TraderRow({
  trader,
  position,
  selected,
  followed,
  onSelect,
  onFollow,
}: {
  trader: RankedTrader;
  position: number;
  selected: boolean;
  followed: boolean;
  onSelect: () => void;
  onFollow: () => void;
}) {
  const pnlPositive = trader.performance.pnlUsd >= 0;
  const avatarTone = AVATAR_TONES[position % AVATAR_TONES.length];

  return (
    <tr
      className={cn(
        "group transition",
        selected ? "bg-emerald-400/[0.045]" : "hover:bg-white/[0.025]",
      )}
    >
      <td className="px-4 py-4 align-middle">
        <span
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-lg font-mono text-[11px] font-bold",
            position <= 3 ? "bg-amber-400/10 text-amber-300" : "text-zinc-600",
          )}
        >
          {position <= 3 ? <Medal className="h-3.5 w-3.5" /> : position}
        </span>
      </td>
      <td className="px-3 py-4">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xs font-black text-white shadow-lg",
              avatarTone,
            )}
          >
            {trader.displayName.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onSelect}
                className="max-w-40 truncate text-left text-[13px] font-semibold text-zinc-100 hover:text-emerald-300"
              >
                {trader.displayName}
              </button>
              {trader.verification === "onchain-verified" ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : trader.verification === "source-reported" ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
              <span>@{trader.handle}</span>
              <span>•</span>
              <span className="font-mono">
                {shortAddress(trader.wallets.solana)}
              </span>
              <button
                type="button"
                onClick={onFollow}
                aria-label={followed ? "Unfollow trader" : "Follow trader"}
                className={cn(
                  "transition hover:text-emerald-300",
                  followed && "text-emerald-400",
                )}
              >
                <Bookmark
                  className={cn("h-3 w-3", followed && "fill-current")}
                />
              </button>
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-4 text-right">
        <p
          className={cn(
            "font-mono text-[13px] font-semibold",
            pnlPositive ? "text-emerald-300" : "text-rose-300",
          )}
        >
          {formatUsd(trader.performance.pnlUsd)}
        </p>
        <p className="mt-1 text-[10px] text-zinc-600">
          Vol {formatUsd(trader.performance.volumeUsd)}
        </p>
      </td>
      <td className="px-3 py-4 text-right font-mono text-[13px] font-semibold text-emerald-300">
        {formatPercent(trader.performance.roiPct, true)}
      </td>
      <td className="px-3 py-4 text-right">
        <p className="font-mono text-[13px] font-semibold text-zinc-200">
          {formatPercent(trader.performance.winRatePct)}
        </p>
        <div className="mt-1.5 ml-auto h-1 w-14 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-cyan-400"
            style={{ width: `${trader.performance.winRatePct ?? 0}%` }}
          />
        </div>
      </td>
      <td className="px-3 py-4 text-right font-mono text-[13px] text-rose-300">
        {formatPercent(trader.performance.maxDrawdownPct)}
      </td>
      <td className="px-3 py-4 text-right">
        <p className="font-mono text-[13px] font-semibold text-zinc-200">
          {formatCount(trader.performance.trades)}
        </p>
        <p className="mt-1 text-[10px] text-zinc-600">
          {trader.holdings} positions
        </p>
      </td>
      <td className="px-3 py-4 text-right font-mono text-[13px] text-zinc-300">
        {formatHold(trader.performance.avgHoldMinutes)}
      </td>
      <td className="px-3 py-4">
        <div className="flex items-center justify-center gap-2">
          <ScoreRing score={trader.copyScore} />
          <span
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase",
              riskTone(trader.risk),
            )}
          >
            {trader.risk}
          </span>
        </div>
      </td>
      <td className="px-3 py-4 text-right">
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold transition",
            selected
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
              : "border-white/8 bg-white/[0.025] text-zinc-400 hover:border-emerald-400/20 hover:text-emerald-300",
          )}
        >
          <Eye className="h-3.5 w-3.5" />
          Preview
        </button>
      </td>
    </tr>
  );
}

function ScoreRing({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-zinc-700 text-[9px] text-zinc-600">
        N/A
      </span>
    );
  }

  const degrees = Math.round((score / 100) * 360);

  return (
    <span
      className="inline-flex h-9 w-9 items-center justify-center rounded-full p-[2px]"
      style={{
        background: `conic-gradient(#34d399 ${degrees}deg, #1a2330 ${degrees}deg)`,
      }}
    >
      <span className="inline-flex h-full w-full items-center justify-center rounded-full bg-[#0b121c] font-mono text-[10px] font-bold text-zinc-100">
        {score}
      </span>
    </span>
  );
}

function CopySetupPanel({
  trader,
  draftCreated,
  onCreateDraft,
}: {
  trader: RankedTrader | null;
  draftCreated: boolean;
  onCreateDraft: () => void;
}) {
  if (!trader) {
    return (
      <aside className="border-t border-white/7 bg-[#0c131e] p-5 xl:border-t-0 xl:border-l">
        <p className="text-sm text-zinc-500">
          Select a trader to preview copy settings.
        </p>
      </aside>
    );
  }

  return (
    <aside className="border-t border-white/7 bg-[linear-gradient(180deg,#0c141f_0%,#0a111a_100%)] p-5 xl:border-t-0 xl:border-l">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.14em] text-emerald-400 uppercase">
            Copy preview
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            {trader.displayName}
          </h2>
          <p className="mt-1 font-mono text-[10px] text-zinc-600">
            {shortAddress(trader.wallets.solana)}
          </p>
        </div>
        <ScoreRing score={trader.copyScore} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <MiniStat
          label="Profit factor"
          value={trader.performance.profitFactor?.toFixed(2) ?? "—"}
        />
        <MiniStat label="Followers" value={formatCount(trader.followers)} />
      </div>

      <div className="mt-5 space-y-4 border-y border-white/7 py-5">
        <SetupField
          label="Copy allocation"
          value="$1,000 USDC"
          icon={WalletCards}
        />
        <SetupField
          label="Size per trade"
          value="10% proportional"
          icon={Layers3}
        />
        <SetupField
          label="Max daily loss"
          value="3% kill switch"
          icon={Target}
        />
        <SetupField label="Max slippage" value="1.5%" icon={Zap} />
      </div>

      <div className="mt-4 rounded-xl border border-cyan-400/10 bg-cyan-400/5 p-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-cyan-200">
          <ShieldCheck className="h-3.5 w-3.5" />
          Simulation only
        </div>
        <p className="mt-1 text-[10px] leading-4 text-cyan-100/55">
          Tạo draft không gửi transaction, không cấp quyền ký và không di chuyển
          tài sản.
        </p>
      </div>

      <button
        type="button"
        onClick={onCreateDraft}
        disabled={draftCreated}
        className={cn(
          "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-bold transition",
          draftCreated
            ? "cursor-default border border-emerald-400/20 bg-emerald-400/8 text-emerald-300"
            : "bg-emerald-400 text-[#06110d] hover:bg-emerald-300",
        )}
      >
        {draftCreated ? (
          <>
            <Check className="h-4 w-4" /> Draft strategy created
          </>
        ) : (
          <>
            <Bot className="h-4 w-4" /> Create draft strategy
          </>
        )}
      </button>

      <p className="mt-3 text-center text-[10px] text-zinc-700">
        Live execution will require a separate explicit confirmation.
      </p>
    </aside>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[0.025] p-3">
      <p className="text-[9px] tracking-wide text-zinc-600 uppercase">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold text-zinc-200">
        {value}
      </p>
    </div>
  );
}

function SetupField({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.035] text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-zinc-600">{label}</p>
        <p className="mt-0.5 text-xs font-semibold text-zinc-200">{value}</p>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-zinc-700" />
    </div>
  );
}

function ActivityPlaceholder() {
  return (
    <div className="grid min-h-[440px] place-items-center p-8">
      <div className="max-w-md text-center">
        <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/15 bg-emerald-400/7 text-emerald-300">
          <Radio className="h-6 w-6" />
        </span>
        <h2 className="mt-5 text-lg font-semibold text-zinc-100">
          Realtime feed is staged
        </h2>
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          Kết nối WebSocket chỉ được bật sau khi lưu event vào database, chống
          duplicate và đối chiếu transaction on-chain. Hiện dashboard chưa giả
          lập lệnh live.
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/7 bg-white/[0.025] px-3 py-1.5 text-[10px] text-zinc-500">
          <Clock3 className="h-3.5 w-3.5" />
          Next: ingestion worker + Helius stream
        </div>
      </div>
    </div>
  );
}

function PrincipleCard({
  icon: Icon,
  number,
  title,
  description,
}: {
  icon: typeof Activity;
  number: string;
  title: string;
  description: string;
}) {
  return (
    <article className="group rounded-2xl border border-white/7 bg-[#0b111a]/80 p-5 transition hover:border-emerald-400/15">
      <div className="flex items-center justify-between">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.035] text-zinc-400 group-hover:text-emerald-300">
          <Icon className="h-4 w-4" />
        </span>
        <span className="font-mono text-[10px] text-zinc-700">{number}</span>
      </div>
      <h3 className="mt-4 text-sm font-semibold text-zinc-200">{title}</h3>
      <p className="mt-2 text-xs leading-5 text-zinc-600">{description}</p>
    </article>
  );
}
