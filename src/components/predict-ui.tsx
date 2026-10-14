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

// ---------------------------------------------------------------------------
// Visual helpers (logos, icons, bars) so tables carry fewer words
// ---------------------------------------------------------------------------

export interface ThemedLogo {
  light?: string;
  dark?: string;
}

/** Instrument logo with light/dark variants; falls back to the symbol's first letter. */
export function MarketLogo({
  logo,
  symbol,
  size = 6,
  className,
}: {
  logo: ThemedLogo | null | undefined;
  symbol: string;
  size?: 5 | 6 | 7 | 8 | 10;
  className?: string;
}) {
  const sizeClass = {
    5: "h-5 w-5",
    6: "h-6 w-6",
    7: "h-7 w-7",
    8: "h-8 w-8",
    10: "h-10 w-10",
  }[size];
  const label = symbol.replace(/-USD$/i, "");
  if (logo?.dark || logo?.light) {
    const dark = logo.dark ?? logo.light;
    const light = logo.light ?? logo.dark;
    return (
      <span
        className={cn(
          "bg-paper-3 relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
          sizeClass,
          className,
        )}
        title={label}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dark}
          alt=""
          className={cn(
            "theme-dark-only rounded-full object-contain",
            sizeClass,
          )}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={light}
          alt=""
          className={cn(
            "theme-light-only rounded-full object-contain",
            sizeClass,
          )}
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      title={label}
      className={cn(
        "border-rule bg-paper-3 text-ink-2 inline-flex shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold",
        sizeClass,
        className,
      )}
    >
      {label.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Overlapping row of logos, e.g. the markets a trader is active in. */
export function LogoStack({
  items,
  max = 4,
  size = 6,
}: {
  items: Array<{
    key: string;
    logo: ThemedLogo | null | undefined;
    symbol: string;
    title?: string;
  }>;
  max?: number;
  size?: 5 | 6 | 7;
}) {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <span className="inline-flex items-center">
      {shown.map((item, index) => (
        <span
          key={item.key}
          title={item.title ?? item.symbol}
          className={cn(
            "ring-paper-2 rounded-full ring-2",
            index > 0 && "-ml-1.5",
          )}
        >
          <MarketLogo logo={item.logo} symbol={item.symbol} size={size} />
        </span>
      ))}
      {rest > 0 && (
        <span className="text-muted ml-1.5 text-[11px]">+{rest}</span>
      )}
    </span>
  );
}

/** Win rate as a number with a small bar underneath. */
export function RateBar({
  value,
  hint,
}: {
  value: number | null;
  hint?: string;
}) {
  if (value == null) return <span className="text-muted">–</span>;
  const pct = Math.round(value * 100);
  const color =
    value >= 0.55 ? "bg-[#4ade80]" : value < 0.5 ? "bg-[#fb7185]" : "bg-accent";
  return (
    <span
      className="inline-flex min-w-[3.5rem] flex-col items-end gap-1"
      title={hint}
    >
      <span
        className={cn(
          "data font-medium",
          value >= 0.55
            ? "text-[#4ade80]"
            : value < 0.5
              ? "text-[#fb7185]"
              : "text-ink",
        )}
      >
        {pct}%
      </span>
      <span className="bg-paper-3 h-1 w-14 overflow-hidden rounded-full">
        <span
          className={cn("block h-full rounded-full", color)}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

/** Positive days out of active days as a strip of ticks. */
export function DaysStrip({
  positive,
  total,
}: {
  positive: number;
  total: number;
}) {
  if (total === 0) return <span className="text-muted">–</span>;
  const ticks = Math.min(total, 30);
  const good = Math.round((positive / total) * ticks);
  return (
    <span
      className="inline-flex flex-col items-end gap-1"
      title={`${positive} of ${total} active days in profit`}
    >
      <span className="data text-ink">
        {positive}
        <span className="text-muted">/{total}</span>
      </span>
      <span className="flex gap-[1px]">
        {Array.from({ length: ticks }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-[3px] rounded-sm",
              i < good ? "bg-[#4ade80]" : "bg-[#fb7185]/60",
            )}
          />
        ))}
      </span>
    </span>
  );
}

const PREDICT_CATEGORY_ICON: Record<string, string> = {
  sports: "🏟️",
  politics: "🏛️",
  crypto: "₿",
  finance: "📈",
  culture: "🎬",
  other: "◌",
};

/** Category chips with an icon and the share of markets; words only on hover. */
export function CategoryChips({
  categories,
  total,
  max = 2,
}: {
  categories: Array<{
    category: string;
    markets: number;
    wins: number;
    pnlUsd: number;
  }>;
  total: number;
  max?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {categories.slice(0, max).map((c) => (
        <span
          key={c.category}
          title={`${CATEGORY_LABEL[c.category] ?? c.category}: ${c.markets} markets · ${Math.round((c.wins / Math.max(1, c.markets)) * 100)}% win`}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px]",
            c.pnlUsd >= 0
              ? "bg-[#22c55e]/10 text-[#4ade80]"
              : "bg-[#f43f5e]/10 text-[#fb7185]",
          )}
        >
          <span aria-hidden>{PREDICT_CATEGORY_ICON[c.category] ?? "◌"}</span>
          <span className="data">
            {Math.round((c.markets / Math.max(1, total)) * 100)}%
          </span>
        </span>
      ))}
    </span>
  );
}

const FLAG_ICON: Record<string, string> = {
  whale: "🐋",
  concentrated: "🎯",
  "sports-only": "🏟️",
  inactive: "💤",
  "small-sample": "🔬",
  "favorite-only": "🪙",
  liquidated: "💥",
  "high-leverage": "⚡",
  scalper: "⏱️",
  new: "🆕",
};

/** Flags as icons only; the explanation lives in the tooltip. */
export function FlagIcons({
  flags,
  kind,
}: {
  flags: string[];
  kind: "predict" | "perp";
}) {
  if (flags.length === 0) return null;
  const meta = kind === "perp" ? PERP_FLAG : PREDICT_FLAG;
  return (
    <span className="inline-flex items-center gap-0.5">
      {flags.map((flag) => (
        <span
          key={flag}
          title={`${meta[flag]?.label ?? flag}: ${meta[flag]?.title ?? ""}`}
          className="bg-paper-3 inline-flex h-5 w-5 items-center justify-center rounded text-[11px]"
        >
          {FLAG_ICON[flag] ?? "•"}
        </span>
      ))}
    </span>
  );
}

/** Collapsible "how it works" line for board footers. */
export function MethodNote({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-muted border-rule border-t px-4 py-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="hover:text-ink inline-flex items-center gap-1"
      >
        <span
          className={cn(
            "inline-block transition-transform",
            open && "rotate-90",
          )}
        >
          ›
        </span>{" "}
        How the score works
      </button>
      {open && <p className="mt-1.5 max-w-3xl leading-5">{children}</p>}
    </div>
  );
}
