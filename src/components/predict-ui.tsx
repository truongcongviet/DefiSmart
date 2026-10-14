"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { predictWatchlist } from "@/lib/local-list";
import { cn } from "@/lib/utils";

/** Pieces shared by the PredictSmart board and trader page. */

export const CATEGORY_LABEL: Record<string, string> = {
  sports: "Sports",
  politics: "Politics",
  crypto: "Crypto",
  finance: "Finance",
  culture: "Culture",
  other: "Other",
};

export const PREDICT_FLAG: Record<
  string,
  { label: string; title: string; className: string }
> = {
  whale: {
    label: "Whale",
    title: "Median stake ≥ $10k; sizes are hard to copy",
    className: "bg-[#f59e0b]/15 text-[#fbbf24]",
  },
  concentrated: {
    label: "One-hit",
    title: "More than half of the profit comes from a single market",
    className: "bg-[#f43f5e]/10 text-[#fb7185]",
  },
  "sports-only": {
    label: "Sports",
    title: "≥ 90% of settled markets are sports",
    className: "bg-paper-3 text-ink-2",
  },
  inactive: {
    label: "Inactive",
    title: "No trade or settlement in the last 14 days",
    className: "bg-paper-3 text-muted",
  },
  "small-sample": {
    label: "<10 mkts",
    title: "Fewer than 10 settled markets",
    className: "bg-paper-3 text-muted",
  },
  "favorite-only": {
    label: "Favorites",
    title: "Wins mostly from entries above 90¢ (tiny payoffs)",
    className: "bg-accent-soft text-accent",
  },
};

export const PERP_FLAG: Record<
  string,
  { label: string; title: string; className: string }
> = {
  whale: {
    label: "Whale",
    title: "Average fill ≥ $50k notional",
    className: "bg-[#f59e0b]/15 text-[#fbbf24]",
  },
  concentrated: {
    label: "One-hit",
    title: "More than half of realized profit from one fill",
    className: "bg-[#f43f5e]/10 text-[#fb7185]",
  },
  liquidated: {
    label: "Liquidated",
    title: "Has liquidation or ADL fills in the sample",
    className: "bg-[#f43f5e]/10 text-[#fb7185]",
  },
  inactive: {
    label: "Inactive",
    title: "No fill in the last 7 days",
    className: "bg-paper-3 text-muted",
  },
  "small-sample": {
    label: "<20 trades",
    title: "Fewer than 20 realized fills in the sample",
    className: "bg-paper-3 text-muted",
  },
  "high-leverage": {
    label: "Lev >10x",
    title: "Open notional above 10× equity",
    className: "bg-[#f59e0b]/15 text-[#fbbf24]",
  },
  new: {
    label: "New",
    title: "Fewer than 5 days of PnL history",
    className: "bg-paper-3 text-muted",
  },
  scalper: {
    label: "Scalper",
    title: "More than 400 fills a day",
    className: "bg-accent-soft text-accent",
  },
};

export function PerpFlags({ flags }: { flags: string[] }) {
  if (flags.length === 0) return <span className="text-muted text-xs">–</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => {
        const meta = PERP_FLAG[flag] ?? {
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

export function SideBadge({ side }: { side: "long" | "short" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold uppercase",
        side === "long"
          ? "bg-[#22c55e]/15 text-[#4ade80]"
          : "bg-[#f43f5e]/10 text-[#fb7185]",
      )}
    >
      {side}
    </span>
  );
}

export function PredictFlags({ flags }: { flags: string[] }) {
  if (flags.length === 0) return <span className="text-muted text-xs">–</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => {
        const meta = PREDICT_FLAG[flag] ?? {
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

export function FollowButton({
  address,
  label,
  list = predictWatchlist,
}: {
  address: string;
  label?: boolean;
  list?: typeof predictWatchlist;
}) {
  const items = list.useList();
  const following = items.includes(address);
  return (
    <button
      type="button"
      onClick={() => list.toggle(address)}
      aria-pressed={following}
      title={following ? "Unfollow" : "Follow trader"}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs transition-colors",
        label ? "px-3" : "w-8",
        following
          ? "bg-accent-soft text-accent"
          : "text-muted hover:bg-paper-3 hover:text-ink",
      )}
    >
      {following ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      {label && (following ? "Following" : "Follow")}
    </button>
  );
}

export function Avatar({
  src,
  name,
  size = 7,
}: {
  src: string | null;
  name: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const className = `h-${size} w-${size}`;
  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        className={cn(
          "border-rule bg-paper-3 inline-block shrink-0 rounded-full border object-cover",
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "border-rule bg-paper-3 text-ink-2 inline-flex shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold",
        className,
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function priceCents(value: number) {
  return `${Math.round(value * 100)}¢`;
}
