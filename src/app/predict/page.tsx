import type { Metadata } from "next";

import { SmartPerpBoard } from "@/components/smart-perp-board";
import { SmartPredictBoard } from "@/components/smart-predict-board";

export const metadata: Metadata = {
  title: "PredictSmart · LP Smart Wallet Radar",
  description:
    "Polymarket prediction-market and perp traders with high win rates and consistent profit, ranked from their own trades.",
};

const WINDOWS = ["day", "week", "month", "all"] as const;
type Window = (typeof WINDOWS)[number];

export default async function PredictPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; window?: string }>;
}) {
  const { tab, window } = await searchParams;
  const initialWindow = WINDOWS.includes(window as Window)
    ? (window as Window)
    : "month";
  return tab === "perp" ? (
    <SmartPerpBoard initialWindow={initialWindow} />
  ) : (
    <SmartPredictBoard />
  );
}
