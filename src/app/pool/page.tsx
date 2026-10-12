import { promises as fs } from "node:fs";
import path from "node:path";

import { PoolExplorer, type ExplorerPool } from "@/components/pool-explorer";

async function loadMeteoraPools(): Promise<ExplorerPool[]> {
  const filePath = path.join(process.cwd(), "data", "met_pools_2h_top.json");

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ExplorerPool[]) : [];
  } catch {
    return [];
  }
}

export default async function PoolPage() {
  const pools = await loadMeteoraPools();
  return <PoolExplorer pools={pools} />;
}
