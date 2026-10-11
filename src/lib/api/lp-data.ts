import {
  fetchDlmmPositionEvents,
  getWalletLpSnapshot,
  type LpPosition,
  type LpSourceStatus,
  type WalletLpSnapshot,
} from "@/lib/api/meteora-lp";

/**
 * Wallet LP data built from on-chain Meteora data (see `meteora-lp.ts`).
 *
 * The functions keep the response envelopes that the analysis code already
 * consumes (`data`, `data.data` + `pagination`, per-protocol overview rows),
 * so scoring, classification and the API routes work without changes.
 */

type PeriodKey = "ALL" | "7D" | "1M" | "3M" | "1Y" | "YTD";
type PeriodMap = Record<PeriodKey, number>;

const PERIOD_DAYS: Record<Exclude<PeriodKey, "ALL" | "YTD">, number> = {
  "7D": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
};

const PERIOD_KEYS: PeriodKey[] = ["ALL", "7D", "1M", "3M", "1Y", "YTD"];
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function toIso(ms: number | null): string | null {
  return ms && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function referenceTimeMs(position: LpPosition): number | null {
  return position.closedAtMs ?? position.updatedAtMs ?? position.createdAtMs;
}

function inPeriod(position: LpPosition, key: PeriodKey, now: number): boolean {
  if (key === "ALL") {
    return true;
  }
  const ref = referenceTimeMs(position);
  if (!ref) {
    return false;
  }
  if (key === "YTD") {
    return ref >= Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  }
  return now - ref <= PERIOD_DAYS[key] * DAY_MS;
}

function periodMap(
  positions: LpPosition[],
  now: number,
  compute: (subset: LpPosition[]) => number,
): PeriodMap {
  const result = {} as PeriodMap;
  for (const key of PERIOD_KEYS) {
    result[key] = compute(positions.filter((item) => inPeriod(item, key, now)));
  }
  return result;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function ageHours(position: LpPosition, now: number): number {
  if (!position.createdAtMs) {
    return 0;
  }
  const end = position.closedAtMs ?? now;
  return Math.max(0, (end - position.createdAtMs) / HOUR_MS);
}

function pairName(position: LpPosition): string {
  const a = position.token0.symbol || "?";
  const b = position.token1.symbol || "?";
  return `${a}-${b}`;
}

function toLpAgentPosition(position: LpPosition, now: number) {
  const createdAt = toIso(position.createdAtMs);
  const updatedAt =
    toIso(position.updatedAtMs) ?? toIso(position.closedAtMs) ?? createdAt;
  const closeAt = toIso(position.closedAtMs);

  return {
    owner: position.owner,
    position: position.position,
    tokenId: position.position,
    pool: position.pool,
    poolAddress: position.pool,
    protocol: position.protocol,
    status: position.isClosed ? "Close" : "Open",
    pairName: pairName(position),
    tokenName0: position.token0.symbol,
    tokenName1: position.token1.symbol,
    token0: position.token0.address,
    token1: position.token1.address,
    token0Info: {
      token_symbol: position.token0.symbol,
      token_address: position.token0.address,
      token_decimals: position.token0.decimals,
      logo: position.token0.logo,
    },
    token1Info: {
      token_symbol: position.token1.symbol,
      token_address: position.token1.address,
      token_decimals: position.token1.decimals,
      logo: position.token1.logo,
    },
    logo0: position.token0.logo,
    logo1: position.token1.logo,
    inputValue: position.depositUsd,
    inputNative: position.depositNative,
    valueNative: position.depositNative,
    outputValue: position.withdrawUsd,
    outputNative: position.withdrawNative,
    collectedFee: position.feeUsd,
    collectedFeeNative: position.feeNative,
    feeNative: position.feeNative,
    pnl: {
      value: position.pnlUsd,
      valueNative: position.pnlNative,
      percent: position.pnlPercent,
      percentNative: position.pnlPercentNative,
    },
    pnlNative: position.pnlNative,
    inRange: position.inRange,
    ageHour: ageHours(position, now),
    createdAt,
    updatedAt,
    closeAt,
    closedAt: closeAt,
  };
}

function sortByClosedDesc(positions: LpPosition[]): LpPosition[] {
  return [...positions].sort(
    (a, b) => (referenceTimeMs(b) ?? 0) - (referenceTimeMs(a) ?? 0),
  );
}

function sortByCreatedDesc(positions: LpPosition[]): LpPosition[] {
  return [...positions].sort(
    (a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0),
  );
}

// ---------------------------------------------------------------------------
// Public API (LP Agent compatible envelopes)
// ---------------------------------------------------------------------------

export async function fetchLpOpeningPositions(owner: string) {
  const snapshot = await getWalletLpSnapshot(owner);
  const now = Date.now();
  const open = sortByCreatedDesc(
    snapshot.positions.filter((item) => !item.isClosed),
  );

  return {
    status: "success",
    count: open.length,
    data: open.map((item) => toLpAgentPosition(item, now)),
  };
}

export async function fetchLpHistoricalPositions(
  owner: string,
  page = 1,
  limit = 100,
) {
  const snapshot = await getWalletLpSnapshot(owner);
  const now = Date.now();
  const closed = sortByClosedDesc(
    snapshot.positions.filter((item) => item.isClosed),
  );

  const pageSize = Math.max(1, Math.min(500, Math.floor(limit) || 100));
  const currentPage = Math.max(1, Math.floor(page) || 1);
  const totalCount = closed.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const start = (currentPage - 1) * pageSize;
  const items = closed.slice(start, start + pageSize);

  return {
    status: "success",
    data: {
      data: items.map((item) => toLpAgentPosition(item, now)),
      pagination: {
        currentPage,
        totalPages,
        totalCount,
        pageSize,
      },
    },
  };
}

function buildOverviewRow(
  owner: string,
  protocol: string,
  positions: LpPosition[],
  now: number,
) {
  const closed = positions.filter((item) => item.isClosed);
  const open = positions.filter((item) => !item.isClosed);
  const pools = new Set(positions.map((item) => item.pool));

  const pnlUsd = (subset: LpPosition[]) => sum(subset.map((i) => i.pnlUsd));
  const pnlNative = (subset: LpPosition[]) =>
    sum(subset.map((i) => i.pnlNative));
  const feeUsd = (subset: LpPosition[]) => sum(subset.map((i) => i.feeUsd));
  const feeNative = (subset: LpPosition[]) =>
    sum(subset.map((i) => i.feeNative));
  const closedOnly = (subset: LpPosition[]) => subset.filter((i) => i.isClosed);
  const winRate = (subset: LpPosition[], pick: (i: LpPosition) => number) => {
    const done = closedOnly(subset);
    return ratio(done.filter((i) => pick(i) > 0).length, done.length);
  };

  const totalInflowUsd = sum(positions.map((i) => i.depositUsd));
  const totalInflowNative = sum(positions.map((i) => i.depositNative));
  const totalOutflowUsd = sum(positions.map((i) => i.withdrawUsd));
  const totalOutflowNative = sum(positions.map((i) => i.withdrawNative));
  const totalPnlUsd = pnlUsd(positions);
  const totalPnlNative = pnlNative(positions);
  const totalFeeUsd = feeUsd(positions);

  const ages = positions
    .map((item) => ageHours(item, now))
    .filter((v) => v > 0);
  const avgAgeHour = mean(ages);
  const roi = ratio(totalPnlUsd, totalInflowUsd);
  const apr = avgAgeHour > 0 ? roi * (8760 / avgAgeHour) : 0;

  const timestamps = positions
    .flatMap((item) => [item.createdAtMs, referenceTimeMs(item)])
    .filter((value): value is number => typeof value === "number" && value > 0);
  const firstActivity = timestamps.length ? Math.min(...timestamps) : null;
  const lastActivity = timestamps.length ? Math.max(...timestamps) : null;

  const activeMonths =
    firstActivity && lastActivity
      ? Math.max(1, (lastActivity - firstActivity) / (30 * DAY_MS))
      : 1;

  return {
    owner,
    chain: "SOL",
    protocol,
    source: "meteora-datapi",
    total_inflow: totalInflowUsd,
    total_inflow_native: totalInflowNative,
    avg_inflow: periodMap(positions, now, (s) =>
      mean(s.map((i) => i.depositUsd)),
    ),
    avg_inflow_native: periodMap(positions, now, (s) =>
      mean(s.map((i) => i.depositNative)),
    ),
    total_outflow: totalOutflowUsd,
    total_outflow_native: totalOutflowNative,
    total_fee: periodMap(positions, now, feeUsd),
    total_fee_native: periodMap(positions, now, feeNative),
    total_reward: 0,
    total_reward_native: 0,
    total_pnl: periodMap(positions, now, pnlUsd),
    total_pnl_native: periodMap(positions, now, pnlNative),
    avg_age_hour: avgAgeHour,
    total_lp: positions.length,
    win_lp: closed.filter((i) => i.pnlUsd > 0).length,
    win_lp_native: closed.filter((i) => i.pnlNative > 0).length,
    closed_lp: periodMap(positions, now, (s) => closedOnly(s).length),
    opening_lp: open.length,
    total_pool: pools.size,
    win_rate: periodMap(positions, now, (s) => winRate(s, (i) => i.pnlUsd)),
    win_rate_native: periodMap(positions, now, (s) =>
      winRate(s, (i) => i.pnlNative),
    ),
    expected_value: periodMap(positions, now, (s) =>
      mean(closedOnly(s).map((i) => i.pnlUsd)),
    ),
    expected_value_native: periodMap(positions, now, (s) =>
      mean(closedOnly(s).map((i) => i.pnlNative)),
    ),
    fee_percent: ratio(totalFeeUsd, totalInflowUsd),
    fee_percent_native: ratio(feeNative(positions), totalInflowNative),
    apr,
    roi,
    roi_avg_inflow: ratio(
      totalPnlUsd,
      mean(positions.map((i) => i.depositUsd)),
    ),
    roi_avg_inflow_native: ratio(
      totalPnlNative,
      mean(positions.map((i) => i.depositNative)),
    ),
    first_activity: toIso(firstActivity),
    last_activity: toIso(lastActivity),
    avg_pos_profit: mean(closed.map((i) => i.pnlUsd)),
    avg_pos_profit_native: mean(closed.map((i) => i.pnlNative)),
    avg_monthly_profit_percent: ratio(roi * 100, activeMonths),
    avg_monthly_pnl: ratio(totalPnlUsd, activeMonths),
    avg_monthly_pnl_native: ratio(totalPnlNative, activeMonths),
    avg_monthly_inflow: ratio(totalInflowUsd, activeMonths),
  };
}

export async function fetchLpOverview(owner: string) {
  const snapshot = await getWalletLpSnapshot(owner);
  const now = Date.now();

  const byProtocol = new Map<string, LpPosition[]>();
  for (const position of snapshot.positions) {
    const list = byProtocol.get(position.protocol) ?? [];
    list.push(position);
    byProtocol.set(position.protocol, list);
  }

  const rows = Array.from(byProtocol.entries()).map(([protocol, positions]) =>
    buildOverviewRow(owner, protocol, positions, now),
  );

  return {
    status: "success",
    data: rows,
    meta: {
      solPrice: snapshot.solPrice,
      fetchedAt: new Date(snapshot.fetchedAt).toISOString(),
      dlmmPoolsTotal: snapshot.dlmmPoolsTotal,
      dlmmPoolsScanned: snapshot.dlmmPoolsScanned,
      warnings: snapshot.warnings,
    },
  };
}

export async function fetchLpRevenue(owner: string) {
  const snapshot = await getWalletLpSnapshot(owner);
  const closed = [...snapshot.positions]
    .filter((item) => item.isClosed && item.closedAtMs)
    .sort((a, b) => (a.closedAtMs ?? 0) - (b.closedAtMs ?? 0));

  return {
    status: "success",
    data: closed.map((item) => ({
      date: toIso(item.closedAtMs),
      position: item.position,
      pool: item.pool,
      protocol: item.protocol,
      pnl: item.pnlUsd,
      pnl_native: item.pnlNative,
      pnl_percent: item.pnlPercent,
      fee: item.feeUsd,
      fee_native: item.feeNative,
      inflow: item.depositUsd,
      inflow_native: item.depositNative,
    })),
  };
}

const EVENT_ACTIONS: Record<string, string> = {
  add: "increase",
  remove: "decrease",
  claim_fee: "claim_fee",
  claim_reward: "claim_reward",
};

export async function fetchLpLogs(
  owner: string,
  chain = "SOL",
  position?: string,
) {
  void chain;
  const snapshot = await getWalletLpSnapshot(owner);

  const targets = position
    ? snapshot.positions.filter((item) => item.position === position)
    : [];

  const logs: Array<Record<string, unknown>> = [];
  for (const target of targets) {
    if (target.protocol !== "meteora_dlmm") {
      continue;
    }
    const events = await fetchDlmmPositionEvents(target.position);
    for (const event of events) {
      logs.push({
        txHash: event.signature,
        action: EVENT_ACTIONS[event.eventType] ?? event.eventType,
        eventType: event.eventType,
        position: target.position,
        pool: target.pool,
        protocol: target.protocol,
        amount0: event.amount0,
        amount1: event.amount1,
        amount0Usd: event.amount0Usd,
        amount1Usd: event.amount1Usd,
        totalUsd: event.totalUsd,
        decimal0: target.token0.decimals,
        decimal1: target.token1.decimals,
        price0: ratio(event.amount0Usd, event.amount0),
        price1: ratio(event.amount1Usd, event.amount1),
        nativePrice: snapshot.solPrice ?? 0,
        timestamp: new Date(event.timestampMs).toISOString(),
        logo0: target.token0.logo,
        logo1: target.token1.logo,
      });
    }
  }

  logs.sort(
    (a, b) => Date.parse(String(b.timestamp)) - Date.parse(String(a.timestamp)),
  );

  return { status: "success", data: logs, count: logs.length };
}

export async function fetchTokenBalances(owner: string) {
  void owner;
  return {
    status: "success",
    data: [] as Array<Record<string, unknown>>,
    message: "Token balances are not part of the on-chain LP data source.",
  };
}

export async function getWalletLpSourceStatus(
  owner: string,
): Promise<LpSourceStatus> {
  const snapshot = await getWalletLpSnapshot(owner);
  return snapshot.sources;
}

export type { LpPosition, LpSourceStatus, WalletLpSnapshot };
export { getWalletLpSnapshot };
