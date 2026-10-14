import type { Metadata } from "next";

import { SmartTradersBoard } from "@/components/smart-traders-board";

export const metadata: Metadata = {
  title: "Smart Traders · LP Smart Wallet Radar",
  description:
    "Wallets that trade Solana meme tokens profitably, ranked from on-chain swaps.",
};

export default function TradersPage() {
  return <SmartTradersBoard />;
}
