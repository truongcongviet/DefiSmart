import type { Metadata } from "next";

import { SmartPerpBoard } from "@/components/smart-perp-board";
import { SmartPredictBoard } from "@/components/smart-predict-board";

export const metadata: Metadata = {
  title: "PredictSmart · LP Smart Wallet Radar",
  description:
    "Polymarket prediction-market and perp traders with high win rates and consistent profit, ranked from their own trades.",
};

export default async function PredictPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return tab === "perp" ? <SmartPerpBoard /> : <SmartPredictBoard />;
}
