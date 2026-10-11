"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Copy,
  Filter,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Table2,
} from "lucide-react";

import { cn } from "@/lib/utils";

type ViewMode = "card" | "table";

interface SmartLpWallet {
  owner: string;
  pnl_chart?: number[];
  win_rate_native?: number | string;
  win_rate?: number | string;
  total_pnl_native?: number | string;
  total_pnl?: number | string;
  pnl_7d_native?: number | string;
  avg_monthly_pnl_native?: number | string;
  avg_age_hour?: number | string;
  opening_lp?: number | string;
  closed_lp?: number | string;
  total_lp?: number | string;
  total_positions?: number | string;
  total_pool?: number | string;
  expected_value?: number | string;
  avg_inflow_native?: number | string;
  total_fee_native?: number | string;
  last_activity?: string;
}

interface SmartLpPagination {
  currentPage: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface SmartLpData {
  smart_lp?: SmartLpWallet[];
  pagination?: Partial<SmartLpPagination>;
}

interface SmartLpResponse {
  message?: string;
  data?: SmartLpData;
  smart_lp?: SmartLpWallet[];
  pagination?: Partial<SmartLpPagination>;
}

interface QueryState {
  page: number;
  pageSize: number;
  orderBy: string;
  minTotalLp: string;
  minAvgAgeHour: string;
  minWinRateNative: string;
  minExpectedValue: string;
  minTotalPnlNative: string;
  minAvgMonthlyPnlNative: string;
  firstActivity: string;
  lastActivity: string;
}

type FilterState = Omit<QueryState, "orderBy" | "page" | "pageSize">;

const DEFAULT_FILTERS: FilterState = {
  minTotalLp: "1000",
  minAvgAgeHour: "0",
  minWinRateNative: "0.7",
  minExpectedValue: "0",
  minTotalPnlNative: "0",
  minAvgMonthlyPnlNative: "6",
  firstActivity: "",
  lastActivity: "1D",
};

const DEFAULT_QUERY: QueryState = {
  page: 1,
  pageSize: 12,
  orderBy: "total_pnl_native:desc",
  ...DEFAULT_FILTERS,
};

const SORT_OPTIONS = [
  { label: "Total Profit", value: "total_pnl_native:desc" },
  { label: "Win Rate", value: "win_rate_native:desc" },
  { label: "Avg Position Age", value: "avg_age_hour:desc" },
  { label: "Total Positions", value: "total_lp:desc" },
  { label: "Total Pools", value: "total_pool:desc" },
  { label: "Expected Value", value: "expected_value:desc" },
  { label: "Avg Invested", value: "avg_inflow_native:desc" },
  { label: "Avg Monthly Profit", value: "avg_monthly_pnl_native:desc" },
  { label: "Fee Earned", value: "total_fee_native:desc" },
  { label: "Last Activity", value: "last_activity:desc" },
];

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatSol(value: unknown) {
  return toNumber(value, 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRate(value: unknown) {
  const raw = toNumber(value, 0);
  const normalized = raw <= 1 ? raw * 100 : raw;
  return `${normalized.toFixed(2)}%`;
}

function formatAgeHour(value: unknown) {
  const hour = toNumber(value, 0);
  if (hour >= 24) {
    return `${(hour / 24).toFixed(1)}d`;
  }
  return `${hour.toFixed(1)}h`;
}

function formatInt(value: unknown) {
  return Math.max(0, Math.round(toNumber(value, 0))).toLocaleString();
}

function shortWallet(wallet: string) {
  if (wallet.length <= 12) {
    return wallet;
  }

  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function getChartValues(wallet: SmartLpWallet) {
  if (!Array.isArray(wallet.pnl_chart)) {
    return [];
  }

  return wallet.pnl_chart.slice(-10).map((item) => toNumber(item, 0));
}

function Sparkline({ values }: { values: number[] }) {
  const maxAbs = useMemo(() => {
    return Math.max(1, ...values.map((value) => Math.abs(value)));
  }, [values]);

  if (values.length === 0) {
    return <div className="h-12 text-xs text-zinc-500">-</div>;
  }

  return (
    <div className="flex h-12 items-end gap-1">
      {values.map((value, index) => (
        <span
          key={`${index}-${value}`}
          className={cn(
            "w-3 rounded-sm",
            value >= 0 ? "bg-emerald-500/90" : "bg-rose-500/90",
          )}
          style={{
            height: `${Math.max(8, Math.round((Math.abs(value) / maxAbs) * 46))}px`,
          }}
        />
      ))}
    </div>
  );
}

function getResponseData(payload: SmartLpResponse): SmartLpData {
  if (payload.data && typeof payload.data === "object") {
    return payload.data;
  }

  return {
    smart_lp: payload.smart_lp,
    pagination: payload.pagination,
  };
}

function buildSearchParams(query: QueryState) {
  const params = new URLSearchParams();

  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  params.set("orderBy", query.orderBy);

  const filterKeys: Array<keyof FilterState> = [
    "minTotalLp",
    "minAvgAgeHour",
    "minWinRateNative",
    "minExpectedValue",
    "minTotalPnlNative",
    "minAvgMonthlyPnlNative",
    "firstActivity",
    "lastActivity",
  ];

  for (const key of filterKeys) {
    const value = query[key].trim();
    if (value !== "") {
      params.set(key, value);
    }
  }

  return params.toString();
}

const inputClassName =
  "h-10 w-full rounded-lg border border-zinc-800 bg-[#080b12] px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-emerald-500";

export function WalletAnalyzer() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [query, setQuery] = useState<QueryState>(DEFAULT_QUERY);
  const [wallets, setWallets] = useState<SmartLpWallet[]>([]);
  const [pagination, setPagination] = useState<SmartLpPagination>({
    currentPage: 1,
    pageSize: DEFAULT_QUERY.pageSize,
    totalCount: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchWallets = useCallback(async (nextQuery: QueryState) => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const queryString = buildSearchParams(nextQuery);
      const response = await fetch(`/api/lpagent/smart-lp?${queryString}`);
      const payload = (await response.json()) as SmartLpResponse;

      if (!response.ok) {
        throw new Error(payload.message || "Failed to fetch Smart LP wallets.");
      }

      const data = getResponseData(payload);
      const nextWallets = Array.isArray(data.smart_lp) ? data.smart_lp : [];
      const rawPagination = data.pagination || {};

      setWallets(nextWallets);
      setPagination({
        currentPage: toNumber(rawPagination.currentPage, nextQuery.page),
        pageSize: toNumber(rawPagination.pageSize, nextQuery.pageSize),
        totalCount: toNumber(rawPagination.totalCount, nextWallets.length),
        totalPages: Math.max(1, toNumber(rawPagination.totalPages, 1)),
        hasNextPage: Boolean(rawPagination.hasNextPage),
        hasPreviousPage: Boolean(rawPagination.hasPreviousPage),
      });
    } catch (error) {
      setWallets([]);
      setPagination((previous) => ({
        ...previous,
        totalCount: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      }));
      setErrorMessage(
        error instanceof Error ? error.message : "Unknown API error.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchWallets(query);
  }, [fetchWallets, query]);

  function updateFilter(name: keyof FilterState, value: string) {
    setFilters((previous) => ({ ...previous, [name]: value }));
  }

  function applyFilter() {
    setQuery((previous) => ({
      ...previous,
      ...filters,
      page: 1,
    }));
  }

  function clearFilter() {
    setFilters(DEFAULT_FILTERS);
    setQuery((previous) => ({
      ...previous,
      ...DEFAULT_FILTERS,
      page: 1,
    }));
  }

  function updateSort(orderBy: string) {
    setQuery((previous) => ({
      ...previous,
      page: 1,
      orderBy,
    }));
  }

  function gotoPage(nextPage: number) {
    setQuery((previous) => ({
      ...previous,
      page: nextPage,
    }));
  }

  async function copyWallet(owner: string) {
    try {
      await navigator.clipboard.writeText(owner);
    } catch {
      setErrorMessage("Không thể copy wallet trên trình duyệt hiện tại.");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-zinc-800 bg-[#0c1018] p-4 shadow-[0_30px_120px_-50px_rgba(0,0,0,0.85)] sm:p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-100">
          <Filter className="h-4 w-4 text-emerald-400" />
          Filters
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-zinc-400">
            Min Total Positions Opened
            <input
              className={inputClassName}
              value={filters.minTotalLp}
              onChange={(event) =>
                updateFilter("minTotalLp", event.target.value)
              }
            />
          </label>

          <label className="text-xs text-zinc-400">
            Min Avg Position Age (hrs)
            <input
              className={inputClassName}
              value={filters.minAvgAgeHour}
              onChange={(event) =>
                updateFilter("minAvgAgeHour", event.target.value)
              }
            />
          </label>

          <label className="text-xs text-zinc-400">
            Min Win Rate
            <input
              className={inputClassName}
              value={filters.minWinRateNative}
              onChange={(event) =>
                updateFilter("minWinRateNative", event.target.value)
              }
            />
          </label>

          <label className="text-xs text-zinc-400">
            Min Expected Value (SOL)
            <input
              className={inputClassName}
              value={filters.minExpectedValue}
              onChange={(event) =>
                updateFilter("minExpectedValue", event.target.value)
              }
            />
          </label>

          <label className="text-xs text-zinc-400">
            Min Profit (SOL)
            <input
              className={inputClassName}
              value={filters.minTotalPnlNative}
              onChange={(event) =>
                updateFilter("minTotalPnlNative", event.target.value)
              }
            />
          </label>

          <label className="text-xs text-zinc-400">
            Min Avg Monthly Profit (SOL)
            <input
              className={inputClassName}
              value={filters.minAvgMonthlyPnlNative}
              onChange={(event) =>
                updateFilter("minAvgMonthlyPnlNative", event.target.value)
              }
            />
          </label>

          <label className="text-xs text-zinc-400">
            Max First Activity
            <input
              className={inputClassName}
              type="date"
              value={filters.firstActivity}
              onChange={(event) =>
                updateFilter("firstActivity", event.target.value)
              }
            />
          </label>

          <label className="text-xs text-zinc-400">
            Last Activity
            <select
              className={inputClassName}
              value={filters.lastActivity}
              onChange={(event) =>
                updateFilter("lastActivity", event.target.value)
              }
            >
              <option value="1D">1D</option>
              <option value="3D">3D</option>
              <option value="7D">7D</option>
              <option value="14D">14D</option>
              <option value="30D">30D</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-zinc-700 bg-[#0a0f16] px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            onClick={clearFilter}
          >
            Clear
          </button>
          <button
            type="button"
            className="rounded-lg border border-emerald-500/60 bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/25"
            onClick={applyFilter}
          >
            Filter
          </button>
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {SORT_OPTIONS.map((option) => {
            const active = query.orderBy === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs font-medium transition",
                  active
                    ? "border-emerald-500/70 bg-emerald-500/20 text-emerald-300"
                    : "border-zinc-800 bg-[#0d1118] text-zinc-300 hover:border-zinc-700 hover:text-zinc-100",
                )}
                onClick={() => updateSort(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium transition",
              viewMode === "card"
                ? "border-emerald-500/70 bg-emerald-500/20 text-emerald-300"
                : "border-zinc-800 bg-[#0d1118] text-zinc-300",
            )}
            onClick={() => setViewMode("card")}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Card
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium transition",
              viewMode === "table"
                ? "border-emerald-500/70 bg-emerald-500/20 text-emerald-300"
                : "border-zinc-800 bg-[#0d1118] text-zinc-300",
            )}
            onClick={() => setViewMode("table")}
          >
            <Table2 className="h-3.5 w-3.5" />
            Table
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-[#0d1118] px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-zinc-700"
            onClick={() => void fetchWallets(query)}
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Reload
          </button>
        </div>
      </section>

      {errorMessage && (
        <p className="rounded-xl border border-rose-800/70 bg-rose-900/30 px-3 py-2 text-sm text-rose-300">
          {errorMessage}
        </p>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-[#0d1118]">
        {viewMode === "table" ? (
          <div className="overflow-x-auto">
            <table className="min-w-[1220px] divide-y divide-zinc-800 text-sm">
              <thead className="bg-[#0f1420] text-xs text-zinc-400 uppercase">
                <tr>
                  <th className="px-3 py-3 text-left">Wallet</th>
                  <th className="px-3 py-3 text-left">7D Profit</th>
                  <th className="px-3 py-3 text-left">Win Rate</th>
                  <th className="px-3 py-3 text-left">Total Profit</th>
                  <th className="px-3 py-3 text-left">Avg Age</th>
                  <th className="px-3 py-3 text-left">Total Positions</th>
                  <th className="px-3 py-3 text-left">Total Pools</th>
                  <th className="px-3 py-3 text-left">EV</th>
                  <th className="px-3 py-3 text-left">Avg Invested</th>
                  <th className="px-3 py-3 text-left">Avg Monthly</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {wallets.map((wallet) => {
                  const chartValues = getChartValues(wallet);
                  const chart7d = chartValues
                    .slice(-7)
                    .reduce((sum, value) => sum + value, 0);
                  const totalProfit = formatSol(wallet.total_pnl_native);
                  const monthlyProfit = formatSol(wallet.avg_monthly_pnl_native);
                  const profitColor =
                    toNumber(wallet.total_pnl_native) >= 0
                      ? "text-emerald-400"
                      : "text-rose-400";

                  const positionParts = [
                    formatInt(wallet.opening_lp),
                    formatInt(wallet.closed_lp ?? wallet.total_positions),
                    formatInt(wallet.total_lp),
                  ];

                  return (
                    <tr key={wallet.owner} className="text-zinc-200">
                      <td className="px-3 py-4">
                        <div className="inline-flex items-center gap-2 text-sm font-medium text-zinc-100">
                          <span>{shortWallet(wallet.owner)}</span>
                          <button
                            type="button"
                            className="text-zinc-400 transition hover:text-zinc-100"
                            onClick={() => void copyWallet(wallet.owner)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        <Sparkline values={chartValues} />
                      </td>
                      <td className="px-3 py-4 font-semibold text-emerald-400">
                        {formatRate(wallet.win_rate_native ?? wallet.win_rate)}
                      </td>
                      <td className="px-3 py-4">
                        <span className={cn("font-semibold", profitColor)}>
                          {formatSol(chart7d)}
                        </span>
                        <span className="mx-1 text-zinc-500">/</span>
                        <span className="font-semibold text-zinc-200">
                          {totalProfit}
                        </span>
                        <span className="mx-1 text-zinc-500">/</span>
                        <span className="font-semibold text-emerald-300">
                          {monthlyProfit}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-zinc-300">
                        {formatAgeHour(wallet.avg_age_hour)}
                      </td>
                      <td className="px-3 py-4 text-zinc-300">
                        {positionParts.join(" / ")}
                      </td>
                      <td className="px-3 py-4 text-zinc-300">
                        {formatInt(wallet.total_pool)}
                      </td>
                      <td className="px-3 py-4 font-medium text-emerald-400">
                        {formatSol(wallet.expected_value)}
                      </td>
                      <td className="px-3 py-4 text-zinc-300">
                        {formatSol(wallet.avg_inflow_native)}
                      </td>
                      <td className="px-3 py-4 text-zinc-300">
                        {monthlyProfit}
                      </td>
                    </tr>
                  );
                })}
                {wallets.length === 0 && !isLoading && (
                  <tr>
                    <td
                      className="px-3 py-8 text-center text-sm text-zinc-500"
                      colSpan={10}
                    >
                      Không có dữ liệu Smart LP phù hợp với filter hiện tại.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {wallets.map((wallet) => (
              <article
                key={wallet.owner}
                className="rounded-xl border border-zinc-800 bg-[#0a0f16] p-4"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-medium text-zinc-100">
                    {shortWallet(wallet.owner)}
                  </p>
                  <button
                    type="button"
                    className="text-zinc-400 transition hover:text-zinc-100"
                    onClick={() => void copyWallet(wallet.owner)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <dl className="space-y-1 text-sm text-zinc-300">
                  <div className="flex items-center justify-between gap-2">
                    <dt>Win Rate</dt>
                    <dd className="font-semibold text-emerald-400">
                      {formatRate(wallet.win_rate_native ?? wallet.win_rate)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt>Total Profit</dt>
                    <dd>{formatSol(wallet.total_pnl_native)} SOL</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt>Expected Value</dt>
                    <dd>{formatSol(wallet.expected_value)} SOL</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt>Total Pool</dt>
                    <dd>{formatInt(wallet.total_pool)}</dd>
                  </div>
                </dl>
              </article>
            ))}
            {wallets.length === 0 && !isLoading && (
              <p className="col-span-full rounded-xl border border-zinc-800 bg-[#0a0f16] px-4 py-8 text-center text-sm text-zinc-500">
                Không có dữ liệu Smart LP phù hợp với filter hiện tại.
              </p>
            )}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center gap-2 border-t border-zinc-800 px-3 py-4 text-sm text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải danh sách LP wallets...
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-3 py-3 text-xs text-zinc-400">
          <p>
            Showing {wallets.length} / {pagination.totalCount.toLocaleString()}{" "}
            wallets
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-zinc-300 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => gotoPage(Math.max(1, pagination.currentPage - 1))}
              disabled={!pagination.hasPreviousPage || isLoading}
            >
              Prev
            </button>
            <span>
              Page {pagination.currentPage} / {pagination.totalPages}
            </span>
            <button
              type="button"
              className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-zinc-300 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() =>
                gotoPage(Math.min(pagination.totalPages, pagination.currentPage + 1))
              }
              disabled={!pagination.hasNextPage || isLoading}
            >
              Next
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}
