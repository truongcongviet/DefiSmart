import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PerpTraderView } from "@/components/perp-trader";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  return { title: `${address.slice(0, 8)}… · Perps · PredictSmart` };
}

export default async function PerpTraderPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!ADDRESS_PATTERN.test(address)) notFound();
  return <PerpTraderView address={address.toLowerCase()} />;
}
