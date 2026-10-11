import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppHeader } from "@/components/app-header";
import { AppProviders } from "@/components/app-providers";

import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CopyPilot — Copy the best on-chain LPs",
  description:
    "Sign in with a wallet or email, get an agent wallet on Solana or Robinhood Chain, and copy liquidity positions from proven LP wallets.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <AppProviders>
          <AppHeader />
          <div className="flex flex-1 flex-col pt-[var(--nav-height)]">
            {children}
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
