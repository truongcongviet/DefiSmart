import { NextResponse } from "next/server";

import { generateAgentKey } from "@/lib/copy-engine/polymarket/agent-wallet";
import { copyKeySecret, getCopyStore } from "@/lib/copy-engine/server";

import { requireCopyUser } from "../_auth";

/** The user's server-side Polygon copy agent: read it, or create it once. */
export async function GET() {
  const gate = await requireCopyUser();
  if ("response" in gate) return gate.response;
  const store = await getCopyStore();
  const agent = await store.getAgent(gate.userId);
  return NextResponse.json({
    configured: true,
    agent: agent
      ? { address: agent.address, createdAt: agent.createdAt }
      : null,
  });
}

export async function POST() {
  const gate = await requireCopyUser();
  if ("response" in gate) return gate.response;
  const store = await getCopyStore();
  const existing = await store.getAgent(gate.userId);
  if (existing) {
    return NextResponse.json({
      agent: { address: existing.address, createdAt: existing.createdAt },
    });
  }
  const generated = generateAgentKey(copyKeySecret());
  const agent = await store.createAgent(
    gate.userId,
    generated.address,
    generated.blob,
  );
  return NextResponse.json(
    {
      agent: agent
        ? { address: agent.address, createdAt: agent.createdAt }
        : null,
    },
    { status: 201 },
  );
}
