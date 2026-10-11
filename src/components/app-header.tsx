"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ConnectWalletButton } from "@/components/auth/connect-wallet-button";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Discover", href: "/" },
  { label: "Pool", href: "/pool" },
  { label: "Analysis", href: "/analysis" },
];

/** N5 floating pill: wordmark · links · one action. Detached from the page edges. */
export function AppHeader() {
  const pathname = usePathname();

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    <header className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <nav
        aria-label="Primary"
        className="border-rule bg-paper/75 pointer-events-auto flex max-w-full items-center gap-1 rounded-full border p-1.5 pl-4 shadow-[0_12px_32px_-16px_oklch(0%_0_0/0.6)] backdrop-blur-xl"
      >
        <Link
          href="/"
          className="text-ink mr-2 inline-flex items-center gap-2 rounded-full font-mono text-sm font-semibold tracking-tight"
        >
          <span
            aria-hidden
            className="bg-accent inline-block h-2 w-2 rounded-full"
          />
          CopyPilot
        </Link>

        <ul className="hidden items-center md:flex">
          {navItems.map((item) => {
            const active = isActive(item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full px-3.5 text-sm transition-colors duration-200",
                    active
                      ? "text-ink"
                      : "text-muted hover:bg-paper-3 hover:text-ink",
                  )}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="bg-accent mr-2 inline-block h-1 w-1 rounded-full"
                    />
                  )}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <span aria-hidden className="bg-rule mx-1 hidden h-5 w-px md:block" />

        <ConnectWalletButton />
      </nav>
    </header>
  );
}
