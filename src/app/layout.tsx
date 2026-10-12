import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { AppHeader } from "@/components/app-header";
import { AppProviders } from "@/components/app-providers";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CopyPilot — Copy the best on-chain LPs",
  description:
    "Sign in with a wallet or email, get an agent wallet on Solana or Robinhood Chain, and copy liquidity positions from proven LP wallets.",
};

/** Applies the saved theme before first paint so there is no flash. */
const themeInitScript = `
(function () {
  try {
    var t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") {
      document.documentElement.setAttribute("data-theme", t);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
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
