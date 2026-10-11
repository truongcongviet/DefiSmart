import { promises as fs } from "node:fs";
import path from "node:path";

interface TokenMetadata {
  symbol?: string;
}

interface MeteoraPoolItem {
  name?: string;
  pool_address?: string;
  token_x?: TokenMetadata;
  token_y?: TokenMetadata;
  volume?: number;
  active_tvl?: number;
  fee_active_tvl_ratio?: number;
  pool_type?: string;
  protocol?: string;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNum(value: unknown) {
  return toNumber(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

async function loadMeteoraPools() {
  const filePath = path.join(process.cwd(), "data", "met_pools_2h_top.json");

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as MeteoraPoolItem[];
    }

    return parsed as MeteoraPoolItem[];
  } catch {
    return [] as MeteoraPoolItem[];
  }
}

export default async function PoolPage() {
  const pools = await loadMeteoraPools();

  const topVolume = pools.reduce<{ name: string; volume: number }>(
    (best, item) => {
      const current = toNumber(item.volume);
      if (current > best.volume) {
        return {
          name: item.name || "-",
          volume: current,
        };
      }

      return best;
    },
    {
      name: "-",
      volume: 0,
    },
  );

  return (
    <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-zinc-800 bg-[#0d1118] p-5">
        <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
          Meteora Pools
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">
          Danh sách pool từ MET API
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Bộ lọc đang dùng: `top`, timeframe `2h`, page size `50`, lọc quality
          token + liquidity/volume tối thiểu.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <article className="rounded-xl border border-zinc-800 bg-[#0a0f16] p-3">
            <p className="text-xs text-zinc-500">Tổng số pool</p>
            <p className="mt-1 text-xl font-semibold text-zinc-100">
              {pools.length.toLocaleString()}
            </p>
          </article>
          <article className="rounded-xl border border-zinc-800 bg-[#0a0f16] p-3">
            <p className="text-xs text-zinc-500">Top volume pool</p>
            <p className="mt-1 truncate text-sm font-semibold text-zinc-100">
              {topVolume.name}
            </p>
          </article>
          <article className="rounded-xl border border-zinc-800 bg-[#0a0f16] p-3">
            <p className="text-xs text-zinc-500">Top volume (2h)</p>
            <p className="mt-1 text-sm font-semibold text-emerald-400">
              {formatNum(topVolume.volume)}
            </p>
          </article>
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-zinc-800 bg-[#0d1118]">
        <table className="min-w-[980px] divide-y divide-zinc-800 text-sm">
          <thead className="bg-[#0f1420] text-xs text-zinc-400 uppercase">
            <tr>
              <th className="px-3 py-3 text-left">#</th>
              <th className="px-3 py-3 text-left">Pool Name</th>
              <th className="px-3 py-3 text-left">Pair</th>
              <th className="px-3 py-3 text-left">Pool Address</th>
              <th className="px-3 py-3 text-right">Volume (2h)</th>
              <th className="px-3 py-3 text-right">Active TVL</th>
              <th className="px-3 py-3 text-right">Fee/TVL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/80">
            {pools.map((pool, index) => (
              <tr key={`${pool.pool_address || pool.name || "pool"}-${index}`}>
                <td className="px-3 py-3 text-zinc-400">{index + 1}</td>
                <td className="px-3 py-3 font-medium text-zinc-100">
                  {pool.name || "-"}
                </td>
                <td className="px-3 py-3 text-zinc-300">
                  {(pool.token_x?.symbol || "?") + "/" + (pool.token_y?.symbol || "?")}
                </td>
                <td className="px-3 py-3 font-mono text-xs text-zinc-400">
                  {pool.pool_address || "-"}
                </td>
                <td className="px-3 py-3 text-right text-zinc-200">
                  {formatNum(pool.volume)}
                </td>
                <td className="px-3 py-3 text-right text-zinc-200">
                  {formatNum(pool.active_tvl)}
                </td>
                <td className="px-3 py-3 text-right text-emerald-400">
                  {toNumber(pool.fee_active_tvl_ratio).toFixed(4)}
                </td>
              </tr>
            ))}
            {pools.length === 0 && (
              <tr>
                <td className="px-3 py-8 text-center text-zinc-500" colSpan={7}>
                  Chưa có dữ liệu pool. Kiểm tra file `data/met_pools_2h_top.json`.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
