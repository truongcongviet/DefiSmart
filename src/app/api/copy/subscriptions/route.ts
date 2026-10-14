import { NextResponse } from "next/server";
import { z } from "zod";

import { readCopySettings } from "@/lib/copy-engine/polymarket/adapter";
import { getCopyStore } from "@/lib/copy-engine/server";

import { requireCopyUser } from "../_auth";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const upsertSchema = z.object({
  leaderWallet: z.string().regex(ADDRESS),
  enabled: z.boolean().optional().default(true),
  settings: z
    .object({
      ratio: z.number().min(0.001).max(1).optional(),
      maxPerTradeUsd: z.number().min(1).max(10_000).optional(),
      dailyCapUsd: z.number().min(1).max(100_000).optional(),
      maxBuyPrice: z.number().min(0.01).max(0.99).optional(),
      mode: z.enum(["dry-run", "live"]).optional(),
      categories: z.array(z.string()).max(10).optional(),
    })
    .optional()
    .default({}),
});

export async function GET() {
  const gate = await requireCopyUser();
  if ("response" in gate) return gate.response;
  const store = await getCopyStore();
  const subscriptions = await store.listSubscriptionsByOwner(gate.userId);
  return NextResponse.json({ subscriptions });
}

/** Creates or updates the user's copy subscription for one leader. */
export async function POST(request: Request) {
  const gate = await requireCopyUser();
  if ("response" in gate) return gate.response;
  const parsed = upsertSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const store = await getCopyStore();
  const agent = await store.getAgent(gate.userId);
  if (!agent) {
    return NextResponse.json(
      { message: "Create your copy agent wallet first." },
      { status: 409 },
    );
  }
  const leader = parsed.data.leaderWallet.toLowerCase();
  const id = `polygon:${leader}:${agent.address.toLowerCase()}`;
  const existing = (await store.listSubscriptionsByOwner(gate.userId)).find(
    (s) => s.id === id,
  );
  const settings = readCopySettings({
    ...(existing?.settings ?? {}),
    ...parsed.data.settings,
  });
  const subscription = {
    id,
    chain: "polygon",
    leaderWallet: leader,
    followerWallet: agent.address,
    enabled: parsed.data.enabled,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    settings: settings as unknown as Record<string, unknown>,
  };
  await store.upsertSubscription(subscription, gate.userId);
  return NextResponse.json(
    { subscription: { ...subscription, ownerUserId: gate.userId } },
    { status: existing ? 200 : 201 },
  );
}

export async function DELETE(request: Request) {
  const gate = await requireCopyUser();
  if ("response" in gate) return gate.response;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ message: "Missing id" }, { status: 400 });
  const store = await getCopyStore();
  const removed = await store.deleteSubscription(id, gate.userId);
  return NextResponse.json({ removed });
}
