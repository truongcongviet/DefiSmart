import { NextResponse } from "next/server";

import { getPoolLpers } from "@/lib/api/pool-lpers";
import type { LpProtocol } from "@/lib/api/meteora-lp";
import { RpcError } from "@/lib/api/solana-rpc";

const ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function readProtocol(value: string | null): LpProtocol | undefined {
  if (value === "dlmm" || value === "meteora_dlmm") return "meteora_dlmm";
  if (value === "damm_v2" || value === "meteora_damm_v2")
    return "meteora_damm_v2";
  return undefined;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const url = new URL(request.url);

  if (!ADDRESS_PATTERN.test(address)) {
    return NextResponse.json(
      { message: "Invalid pool address." },
      { status: 400 },
    );
  }

  try {
    const result = await getPoolLpers(address, {
      protocol: readProtocol(url.searchParams.get("protocol")),
      force: url.searchParams.get("refresh") === "1",
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RpcError) {
      return NextResponse.json(
        {
          message: `Solana RPC error: ${error.message}. Set SOLANA_RPC_URL to a private endpoint if the public one keeps rate-limiting.`,
        },
        { status: 502 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to load pool LPs";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ message }, { status });
  }
}
