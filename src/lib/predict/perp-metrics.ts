import {
  instrumentLogo,
  type PerpFill,
  type PerpInstrument,
  type PerpLogo,
  type PerpPortfolio,
  type PerpWindow,
} from "./perps-api";

/**
 * Trader quality on Polymarket Perps from the account's own fills: every
 * fill that reduces a position carries its realized PnL, so wins, losses,
 * profit factor and liquidations come straight from the tape. Daily PnL
 * points give consistency and drawdown.
 */

export interface PerpInstrumentStat {
  instrumentId: number;
  symbol: string;
  logo: PerpLogo | null;
  category: string;
  trades: number;
  wins: number;
  pnlUsd: number;
}

export interface PerpOpenPosition {
  instrumentId: number;
  symbol: string;
  logo: PerpLogo | null;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  roe: number;
}

/** The same figures restricted to one leaderboard window. */
export interface PerpWindowStats {
  window: PerpWindow;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  /** Realized PnL of the fills in the window (sample). */
  realizedPnlUsd: number;
  profitFactor: number | null;
  /** PnL from the series: hourly points for "day", daily otherwise. */
  pnlUsd: number;
  /** Periods with activity and how many were positive (hours for "day", days otherwise). */
  periods: number;
  positivePeriods: number;
  maxDrawdownUsd: number;
}

export const PERP_WINDOW_DAYS: Record<PerpWindow, number | null> = {
  day: 1,
  week: 7,
  month: 30,
  all: null,
};

export interface PerpMetrics {
  windows: Record<PerpWindow, PerpWindowStats>;
  /** Fills that realized PnL (position reductions). */
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnlUsd: number;
  feesUsd: number;
  profitFactor: number | null;
  /** Fill count in the sample and notional traded. */
  fills: number;
  notionalUsd: number;
  avgFillNotionalUsd: number;
  longShare: number;
  takerShare: number;
  liquidations: number;
  topWinShare: number;
  instruments: PerpInstrumentStat[];
  /** From the 30-day daily PnL series. */
  days: number;
  positiveDays: number;
  pnl30dUsd: number;
  maxDrawdownUsd: number;
  equityUsd: number;
  openPositions: PerpOpenPosition[];
  openNotionalUsd: number;
  unrealizedPnlUsd: number;
  firstFillAt: string | null;
  lastFillAt: string | null;
  flags: PerpFlag[];
}

export type PerpFlag =
  | "whale"
  | "concentrated"
  | "liquidated"
  | "inactive"
  | "small-sample"
  | "high-leverage"
  | "scalper"
  | "new";

const num = (value: string | number | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const DAY_MS = 86_400_000;
const INACTIVE_DAYS = 7;

function drawdownOf(points: Array<[number, number]>) {
  let peak = 0;
  let running = 0;
  let maxDrawdown = 0;
  for (const [, pnl] of [...points].sort((a, b) => a[0] - b[0])) {
    running += pnl;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
  }
  return maxDrawdown;
}

export function computeWindowStats(
  window: PerpWindow,
  fills: PerpFill[],
  daily: Array<[number, number]>,
  hourly: Array<[number, number]>,
  nowMs: number,
): PerpWindowStats {
  const days = PERP_WINDOW_DAYS[window];
  const since = days == null ? 0 : nowMs - days * DAY_MS;
  const inWindow = fills.filter((f) => f.timestamp >= since);
  const closed = inWindow.filter((f) => Math.abs(num(f.pnl)) > 1e-9);
  const wins = closed.filter((f) => num(f.pnl) > 0);
  const losses = closed.filter((f) => num(f.pnl) < 0);
  const grossWin = wins.reduce((s, f) => s + num(f.pnl), 0);
  const grossLoss = -losses.reduce((s, f) => s + num(f.pnl), 0);
  const points = (window === "day" ? hourly : daily).filter(
    ([ts]) => ts >= since,
  );
  return {
    window,
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    realizedPnlUsd: closed.reduce((s, f) => s + num(f.pnl), 0),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length ? null : 0,
    pnlUsd: points.reduce((s, [, v]) => s + v, 0),
    periods: points.length,
    positivePeriods: points.filter(([, v]) => v > 0).length,
    maxDrawdownUsd: drawdownOf(points),
  };
}

export function computePerpMetrics(input: {
  fills: PerpFill[];
  portfolio: PerpPortfolio;
  /** Daily PnL points, as far back as the account goes. */
  series: Array<[number, number]>;
  /** Hourly PnL points for the last two days (for the "day" window). */
  hourly?: Array<[number, number]>;
  instruments: Map<number, PerpInstrument>;
  nowMs?: number;
}): PerpMetrics {
  const now = input.nowMs ?? Date.now();
  const hourly = input.hourly ?? [];
  const symbolOf = (id: number) =>
    input.instruments.get(id)?.symbol ?? `#${id}`;
  const categoryOf = (id: number) =>
    input.instruments.get(id)?.category ?? "other";
  const logoOf = (id: number) => instrumentLogo(input.instruments.get(id));

  const fills = [...input.fills].sort((a, b) => a.timestamp - b.timestamp);
  const closed = fills.filter((fill) => Math.abs(num(fill.pnl)) > 1e-9);
  const wins = closed.filter((fill) => num(fill.pnl) > 0);
  const losses = closed.filter((fill) => num(fill.pnl) < 0);
  const grossWin = wins.reduce((s, f) => s + num(f.pnl), 0);
  const grossLoss = -losses.reduce((s, f) => s + num(f.pnl), 0);
  const realized = closed.reduce((s, f) => s + num(f.pnl), 0);
  const fees = fills.reduce((s, f) => s + num(f.total_fee), 0);
  const notional = fills.reduce(
    (s, f) => s + num(f.price) * num(f.quantity),
    0,
  );
  const longs = fills.filter((f) => f.side === "long").length;
  const takers = fills.filter((f) => f.taker).length;
  const liquidations = fills.filter((f) => f.liquidation || f.adl).length;
  const topWin = wins.reduce((m, f) => Math.max(m, num(f.pnl)), 0);

  const byInstrument = new Map<number, PerpInstrumentStat>();
  for (const fill of fills) {
    const stat = byInstrument.get(fill.instrument_id) ?? {
      instrumentId: fill.instrument_id,
      symbol: symbolOf(fill.instrument_id),
      logo: logoOf(fill.instrument_id),
      category: categoryOf(fill.instrument_id),
      trades: 0,
      wins: 0,
      pnlUsd: 0,
    };
    const pnl = num(fill.pnl);
    if (Math.abs(pnl) > 1e-9) {
      stat.trades += 1;
      if (pnl > 0) stat.wins += 1;
      stat.pnlUsd += pnl;
    }
    byInstrument.set(fill.instrument_id, stat);
  }
  const instruments = Array.from(byInstrument.values())
    .filter((s) => s.trades > 0)
    .sort((a, b) => b.pnlUsd - a.pnlUsd);

  const allDaily = [...input.series].sort((a, b) => a[0] - b[0]);
  const series = allDaily.filter(([ts]) => ts >= now - 30 * DAY_MS);
  const positiveDays = series.filter(([, pnl]) => pnl > 0).length;
  const pnl30d = series.reduce((s, [, pnl]) => s + pnl, 0);
  let peak = 0;
  let running = 0;
  let maxDrawdown = 0;
  for (const [, pnl] of series) {
    running += pnl;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
  }

  const equity = num(input.portfolio.equity);
  const openPositions: PerpOpenPosition[] = input.portfolio.positions
    .map((p) => {
      const size = num(p.size);
      const entry = num(p.entry_price);
      return {
        instrumentId: p.instrument_id,
        symbol: p.symbol || symbolOf(p.instrument_id),
        logo: logoOf(p.instrument_id),
        side: size < 0 ? ("short" as const) : ("long" as const),
        size: Math.abs(size),
        entryPrice: entry,
        notionalUsd: Math.abs(size) * entry,
        unrealizedPnlUsd: num(p.unrealized_pnl),
        roe: num(p.return_on_equity),
      };
    })
    .filter((p) => p.size > 0)
    .sort((a, b) => b.notionalUsd - a.notionalUsd);
  const openNotional = openPositions.reduce((s, p) => s + p.notionalUsd, 0);
  const unrealized = openPositions.reduce((s, p) => s + p.unrealizedPnlUsd, 0);

  const lastFill = fills.length ? fills[fills.length - 1].timestamp : null;
  const firstFill = fills.length ? fills[0].timestamp : null;
  const avgFillNotional = fills.length ? notional / fills.length : 0;
  const spanDays =
    firstFill && lastFill
      ? Math.max(1 / 24, (lastFill - firstFill) / DAY_MS)
      : 0;

  const flags: PerpFlag[] = [];
  if (closed.length < 20) flags.push("small-sample");
  if (realized > 0 && topWin / realized > 0.5 && closed.length >= 5)
    flags.push("concentrated");
  if (liquidations > 0) flags.push("liquidated");
  if (avgFillNotional >= 50_000) flags.push("whale");
  if (lastFill != null && now - lastFill > INACTIVE_DAYS * DAY_MS)
    flags.push("inactive");
  if (equity > 0 && openNotional / equity > 10) flags.push("high-leverage");
  if (allDaily.length < 5) flags.push("new");
  // Only judged when the sample spans at least a day; 300 fills in two hours
  // of a busy session say nothing about the usual pace.
  if (spanDays >= 1 && fills.length / spanDays > 400) flags.push("scalper");

  const windows = {
    day: computeWindowStats("day", fills, allDaily, hourly, now),
    week: computeWindowStats("week", fills, allDaily, hourly, now),
    month: computeWindowStats("month", fills, allDaily, hourly, now),
    all: computeWindowStats("all", fills, allDaily, hourly, now),
  };

  return {
    windows,
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    realizedPnlUsd: realized,
    feesUsd: fees,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length ? null : 0,
    fills: fills.length,
    notionalUsd: notional,
    avgFillNotionalUsd: avgFillNotional,
    longShare: fills.length ? longs / fills.length : 0,
    takerShare: fills.length ? takers / fills.length : 0,
    liquidations,
    topWinShare: realized > 0 ? clamp01(topWin / realized) : 0,
    instruments,
    days: series.length,
    positiveDays,
    pnl30dUsd: pnl30d,
    maxDrawdownUsd: maxDrawdown,
    equityUsd: equity,
    openPositions,
    openNotionalUsd: openNotional,
    unrealizedPnlUsd: unrealized,
    firstFillAt: firstFill ? new Date(firstFill).toISOString() : null,
    lastFillAt: lastFill ? new Date(lastFill).toISOString() : null,
    flags,
  };
}

/**
 * 0–100. Win rate (sample-weighted), 30-day PnL relative to the best in the
 * set, profit factor, share of positive days, drawdown control; liquidations,
 * one-hit profits, whales and inactivity cost points.
 */
export function scorePerpTrader(m: PerpMetrics, maxPnl30dUsd: number): number {
  const confidence = clamp01(m.closedTrades / 100);
  const pnl = m.pnl30dUsd > 0 ? clamp01(m.pnl30dUsd / maxPnl30dUsd) : 0;
  const pf = m.profitFactor == null ? 1 : clamp01(m.profitFactor / 2.5);
  // A 1-for-1 day record says nothing; weight consistency by days seen.
  const consistency =
    m.days > 0 ? (m.positiveDays / m.days) * clamp01(m.days / 10) : 0;
  const drawdown =
    m.pnl30dUsd > 0
      ? clamp01(1 - m.maxDrawdownUsd / (m.pnl30dUsd + m.maxDrawdownUsd))
      : 0;
  let raw =
    0.3 * m.winRate * (0.4 + 0.6 * confidence) +
    0.25 * Math.sqrt(pnl) +
    0.15 * pf +
    0.15 * consistency +
    0.15 * drawdown;
  if (m.flags.includes("small-sample")) raw *= 0.6;
  if (m.flags.includes("liquidated")) raw -= 0.1;
  if (m.flags.includes("concentrated")) raw -= 0.1;
  if (m.flags.includes("inactive")) raw -= 0.1;
  if (m.flags.includes("whale")) raw -= 0.05;
  if (m.flags.includes("high-leverage")) raw -= 0.05;
  if (m.flags.includes("new")) raw -= 0.1;
  return Math.round(clamp01(raw) * 100);
}
