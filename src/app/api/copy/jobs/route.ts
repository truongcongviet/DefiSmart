import { NextResponse } from "next/server";

import { getCopyStore } from "@/lib/copy-engine/server";

import { requireCopyUser } from "../_auth";

/** Recent copy jobs of one of the user's subscriptions. */
export async function GET(request: Request) {
  const gate = await requireCopyUser();
  if ("response" in gate) return gate.response;
  const id = new URL(request.url).searchParams.get("subscription") ?? "";
  if (!id)
    return NextResponse.json(
      { message: "Missing subscription" },
      { status: 400 },
    );
  const store = await getCopyStore();
  const owned = (await store.listSubscriptionsByOwner(gate.userId)).some(
    (s) => s.id === id,
  );
  if (!owned)
    return NextResponse.json(
      { message: "Not your subscription" },
      { status: 404 },
    );
  const jobs = await store.listJobsBySubscription(id, 30);
  return NextResponse.json({ jobs });
}
