import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export async function GET() {
  const filePath = path.join(process.cwd(), "data", "met_pools_2h_top.json");

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        total: 0,
        pools: [],
      });
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      total: parsed.length,
      pools: parsed,
    });
  } catch {
    return NextResponse.json(
      {
        message: "Cannot read Meteora pools snapshot",
      },
      { status: 500 },
    );
  }
}
