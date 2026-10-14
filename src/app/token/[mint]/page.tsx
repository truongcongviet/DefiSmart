import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TokenTraders } from "@/components/token-traders";

const ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ mint: string }>;
}): Promise<Metadata> {
  const { mint } = await params;
  return { title: `${mint.slice(0, 6)}… traders · LP Smart Wallet Radar` };
}

export default async function TokenPage({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = await params;
  if (!ADDRESS_PATTERN.test(mint)) notFound();
  return <TokenTraders mint={mint} />;
}
