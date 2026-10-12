import { promises as fs } from "node:fs";
import path from "node:path";

import {
  PoolExplorer,
  type ExplorerPool,
  type ExplorerPage,
} from "@/components/pool-explorer";
import { fetchDiscoveryPools } from "@/lib/api/meteora-pools";

export const dynamic = "force-dynamic";

async function loadSnapshot(): Promise<ExplorerPool[]> {
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), "data", "met_pools_2h_top.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ExplorerPool[]) : [];
  } catch {
    return [];
  }
}

export default async function PoolPage() {
  let initial: ExplorerPage;
  try {
    const page = await fetchDiscoveryPools({
      timeframe: "2h",
      category: "top",
    });
    initial = {
      data: page.data as ExplorerPool[],
      total: page.total,
      afterKey: page.afterKey,
      hasMore: page.hasMore,
      fetchedAt: page.fetchedAt,
      source: "live",
    };
  } catch {
    const data = await loadSnapshot();
    initial = {
      data,
      total: data.length,
      afterKey: null,
      hasMore: false,
      fetchedAt: null,
      source: "snapshot",
    };
  }

  return <PoolExplorer initial={initial} />;
}
