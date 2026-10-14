"use client";

import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Eye,
  EyeOff,
} from "lucide-react";

import { watchlist } from "@/lib/local-list";
import { cn } from "@/lib/utils";

/** Shared pieces of the leaderboard-style tables. */

export function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function formatUsd(value: number, digits = 0) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: Math.max(digits, abs < 10 ? 2 : 0),
  })}`;
}

export function formatCompact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatPrice(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "–";
  if (value >= 1)
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (value >= 0.001) return `$${value.toFixed(4)}`;
  const exp = Math.floor(Math.log10(value));
  return `$${value.toFixed(Math.min(12, -exp + 3))}`;
}

export function humanMinutes(minutes: number | null) {
  if (minutes == null || !Number.isFinite(minutes)) return "–";
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 60 / 24).toFixed(1)}d`;
}

export function relative(iso: string | null) {
  if (!iso) return "–";
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function tone(value: number) {
  if (value > 0) return "text-[#4ade80]";
  if (value < 0) return "text-[#fb7185]";
  return "text-ink-2";
}

export function scoreTone(score: number) {
  if (score >= 70) return "bg-[#22c55e]/15 text-[#4ade80]";
  if (score >= 45) return "bg-accent-soft text-accent";
  return "bg-paper-3 text-muted";
}

export function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className={cn(
        "data inline-flex h-6 min-w-10 items-center justify-center rounded-md px-2 text-xs font-semibold",
        scoreTone(score),
      )}
    >
      {score}
    </span>
  );
}

export function Th<K extends string>({
  label,
  sortKey,
  active,
  direction,
  onSort,
  align = "right",
  title,
}: {
  label: string;
  sortKey?: K;
  active: K;
  direction: "asc" | "desc";
  onSort: (key: K) => void;
  align?: "left" | "right";
  title?: string;
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
      title={title}
      className={cn(
        "text-muted px-4 py-2.5 text-xs font-medium tracking-wide whitespace-nowrap uppercase",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort(sortKey as K)}
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

export function Kpi({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
      <span className="text-muted text-xs">{label}</span>
      <span
        className={cn("data text-ink text-[15px] font-medium", valueClassName)}
      >
        {value}
      </span>
      {hint && <span className="text-muted text-[11px]">{hint}</span>}
    </div>
  );
}

export function WatchButton({ owner }: { owner: string }) {
  const watched = watchlist.useList();
  const isWatched = watched.includes(owner);
  return (
    <button
      type="button"
      onClick={() => watchlist.toggle(owner)}
      aria-pressed={isWatched}
      aria-label={isWatched ? "Stop watching" : "Watch wallet"}
      title={isWatched ? "Stop watching" : "Watch wallet"}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
        isWatched
          ? "bg-accent-soft text-accent"
          : "text-muted hover:bg-paper-3 hover:text-ink",
      )}
    >
      {isWatched ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
    </button>
  );
}

const FLAG_LABEL: Record<
  string,
  { label: string; title: string; className: string }
> = {
  sniper: {
    label: "Sniper",
    title: "Buys within 60s of pool creation on most tokens",
    className: "bg-[#f59e0b]/15 text-[#fbbf24]",
  },
  bot: {
    label: "Bot",
    title: "Very high trade count or sub-2-minute holds",
    className: "bg-[#f43f5e]/10 text-[#fb7185]",
  },
  "single-token": {
    label: "1 token",
    title: "Only one token traded in the window",
    className: "bg-paper-3 text-muted",
  },
  holding: {
    label: "Holding",
    title: "No fully closed positions yet",
    className: "bg-accent-soft text-accent",
  },
};

export function FlagPills({ flags }: { flags: string[] }) {
  if (flags.length === 0) return <span className="text-muted text-xs">–</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => {
        const meta = FLAG_LABEL[flag] ?? {
          label: flag,
          title: flag,
          className: "bg-paper-3 text-muted",
        };
        return (
          <span
            key={flag}
            title={meta.title}
            className={cn(
              "inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium uppercase",
              meta.className,
            )}
          >
            {meta.label}
          </span>
        );
      })}
    </span>
  );
}

export const PAGE_SIZES = [25, 50, 100] as const;

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPage,
  onPageSize,
  disabled,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  disabled?: boolean;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const button =
    "border-rule text-ink-2 hover:border-rule-2 hover:text-ink inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="border-rule flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-xs">
      <span className="text-muted">
        {total === 0
          ? "No rows"
          : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}
      </span>
      <div className="flex items-center gap-2">
        <label className="text-muted inline-flex items-center gap-1.5">
          Rows
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            disabled={disabled}
            className="border-rule bg-paper text-ink h-8 rounded-lg border px-2 text-xs outline-none"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={button}
          disabled={disabled || page <= 1}
          onClick={() => onPage(1)}
          aria-label="First page"
        >
          «
        </button>
        <button
          type="button"
          className={button}
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          ‹
        </button>
        <span className="data text-ink px-1">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          className={button}
          disabled={disabled || page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          ›
        </button>
        <button
          type="button"
          className={button}
          disabled={disabled || page >= totalPages}
          onClick={() => onPage(totalPages)}
          aria-label="Last page"
        >
          »
        </button>
      </div>
    </div>
  );
}
