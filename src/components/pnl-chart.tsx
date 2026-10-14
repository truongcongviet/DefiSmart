"use client";

import { useId, useMemo, useState } from "react";

import { formatUsd } from "@/components/board-ui";
import { cn } from "@/lib/utils";

/**
 * Daily PnL as bars (sign by position, colour as reinforcement) with the
 * cumulative curve on top. Inline SVG, animated on mount, crosshair tooltip.
 */

export interface PnlPoint {
  /** Unix milliseconds. */
  at: number;
  value: number;
}

const W = 720;
const H = 200;
const PAD = { top: 14, right: 12, bottom: 26, left: 62 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (max === min) return [min];
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ??
    mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step)
    ticks.push(v);
  if (!ticks.includes(0) && min < 0 && max > 0) ticks.push(0);
  return ticks.sort((a, b) => a - b);
}

function tickLabel(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000)
    return `${sign}$${(abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1)}M`;
  if (abs >= 1_000)
    return `${sign}$${(abs / 1_000).toFixed(abs % 1_000 === 0 ? 0 : 1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function shortDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function PnlChart({
  points,
  className,
  periodLabel = "day",
  cumulative = false,
}: {
  points: PnlPoint[];
  className?: string;
  periodLabel?: string;
  /** When true, `value` is already the running total; bars show the change. */
  cumulative?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    const sorted = [...points].sort((a, b) => a.at - b.at);
    const rows = sorted.reduce<Array<PnlPoint & { cumulative: number }>>(
      (acc, p, index) => {
        if (cumulative) {
          const previous =
            index === 0 ? p.value : acc[acc.length - 1].cumulative;
          acc.push({
            at: p.at,
            value: p.value - previous,
            cumulative: p.value,
          });
        } else {
          const previous = acc.length ? acc[acc.length - 1].cumulative : 0;
          acc.push({ ...p, cumulative: previous + p.value });
        }
        return acc;
      },
      [],
    );
    const values = rows.flatMap((r) => [r.value, r.cumulative, 0]);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const span = max - min || 1;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const y = (v: number) => PAD.top + ((max - v) / span) * innerH;
    const slot = rows.length ? innerW / rows.length : innerW;
    const barW = Math.max(3, Math.min(18, slot - 2));
    const x = (i: number) => PAD.left + i * slot + slot / 2;
    const line = rows
      .map(
        (r, i) =>
          `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(r.cumulative).toFixed(1)}`,
      )
      .join(" ");
    const area = rows.length
      ? `${line} L${x(rows.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`
      : "";
    const ticks = niceTicks(min, max);
    const length = rows.reduce((acc, r, i) => {
      if (i === 0) return 0;
      const dx = x(i) - x(i - 1);
      const dy = y(r.cumulative) - y(rows[i - 1].cumulative);
      return acc + Math.hypot(dx, dy);
    }, 0);
    return {
      rows,
      y,
      x,
      barW,
      slot,
      line,
      area,
      ticks,
      zero: y(0),
      length,
      innerW,
    };
  }, [points, cumulative]);

  if (model.rows.length === 0) {
    return (
      <p className={cn("text-muted text-xs", className)}>No PnL history yet.</p>
    );
  }

  const active = hover != null ? model.rows[hover] : null;
  const last = model.rows[model.rows.length - 1];
  const labelIdx = [
    0,
    Math.floor((model.rows.length - 1) / 2),
    model.rows.length - 1,
  ].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className={cn("relative", className)}>
      <style>{`
        @keyframes pnl-grow-${id} { from { transform: scaleY(0); } to { transform: scaleY(1); } }
        @keyframes pnl-draw-${id} { from { stroke-dashoffset: ${model.length.toFixed(0)}; } to { stroke-dashoffset: 0; } }
        @keyframes pnl-fade-${id} { from { opacity: 0; } to { opacity: 1; } }
        .pnl-bar-${id} { transform-box: fill-box; transform-origin: center bottom; animation: pnl-grow-${id} 520ms cubic-bezier(.2,.8,.2,1) both; }
        .pnl-bar-neg-${id} { transform-origin: center top; }
        .pnl-line-${id} { stroke-dasharray: ${model.length.toFixed(0)}; animation: pnl-draw-${id} 1100ms cubic-bezier(.4,0,.2,1) 200ms both; }
        .pnl-area-${id} { animation: pnl-fade-${id} 700ms ease-out 700ms both; }
        @media (prefers-reduced-motion: reduce) {
          .pnl-bar-${id}, .pnl-line-${id}, .pnl-area-${id} { animation: none; }
        }
      `}</style>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full select-none"
        role="img"
        aria-label={`Cumulative PnL ${formatUsd(last.cumulative)} over ${model.rows.length} ${periodLabel}s`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round((px - PAD.left - model.slot / 2) / model.slot);
          setHover(Math.max(0, Math.min(model.rows.length - 1, i)));
        }}
      >
        <defs>
          <linearGradient id={`area-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {model.ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={model.y(t)}
              y2={model.y(t)}
              stroke="var(--rule)"
              strokeWidth={t === 0 ? 1.2 : 1}
              strokeDasharray={t === 0 ? undefined : "2 4"}
            />
            <text
              x={PAD.left - 8}
              y={model.y(t) + 3.5}
              textAnchor="end"
              fontSize="10"
              fontFamily="var(--font-mono)"
              fill="var(--muted)"
            >
              {tickLabel(t)}
            </text>
          </g>
        ))}

        {model.rows.map((r, i) => {
          const top = Math.min(model.y(r.value), model.zero);
          const h = Math.max(1.5, Math.abs(model.y(r.value) - model.zero));
          const neg = r.value < 0;
          return (
            <rect
              key={r.at}
              className={cn(`pnl-bar-${id}`, neg && `pnl-bar-neg-${id}`)}
              style={{ animationDelay: `${i * 18}ms` }}
              x={model.x(i) - model.barW / 2}
              y={top}
              width={model.barW}
              height={h}
              rx={Math.min(3, model.barW / 2)}
              fill={neg ? "var(--danger)" : "var(--ok)"}
              opacity={hover == null || hover === i ? 0.85 : 0.35}
            />
          );
        })}

        <path
          d={model.area}
          className={`pnl-area-${id}`}
          fill={`url(#area-${id})`}
        />
        <path
          d={model.line}
          className={`pnl-line-${id}`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {labelIdx.map((i) => (
          <text
            key={i}
            x={model.x(i)}
            y={H - 8}
            textAnchor={
              i === 0 ? "start" : i === model.rows.length - 1 ? "end" : "middle"
            }
            fontSize="10"
            fontFamily="var(--font-mono)"
            fill="var(--muted)"
          >
            {shortDate(model.rows[i].at)}
          </text>
        ))}

        {active && hover != null && (
          <g>
            <line
              x1={model.x(hover)}
              x2={model.x(hover)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--rule-2)"
              strokeWidth="1"
            />
            <circle
              cx={model.x(hover)}
              cy={model.y(active.cumulative)}
              r="4.5"
              fill="var(--accent)"
              stroke="var(--paper-2)"
              strokeWidth="2"
            />
          </g>
        )}
        {hover == null && (
          <circle
            cx={model.x(model.rows.length - 1)}
            cy={model.y(last.cumulative)}
            r="4"
            fill="var(--accent)"
            stroke="var(--paper-2)"
            strokeWidth="2"
            className={`pnl-area-${id}`}
          />
        )}
      </svg>

      {active && hover != null && (
        <div
          className="border-rule bg-paper pointer-events-none absolute top-2 rounded-lg border px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: `${Math.min(84, Math.max(2, (model.x(hover) / W) * 100))}%`,
            transform: "translateX(-50%)",
          }}
        >
          <div className="text-muted">
            {new Date(active.at).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: periodLabel === "hour" ? "numeric" : undefined,
            })}
          </div>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "data font-medium",
                active.value >= 0 ? "text-[#4ade80]" : "text-[#fb7185]",
              )}
            >
              {formatUsd(active.value)}
            </span>
            <span className="data text-ink">
              Σ {formatUsd(active.cumulative)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
