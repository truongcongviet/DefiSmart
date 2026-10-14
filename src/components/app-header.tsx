"use client";

import { Search, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ConnectWalletButton } from "@/components/auth/connect-wallet-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Smart LP", href: "/" },
  { label: "Smart Traders", href: "/traders" },
  { label: "PredictSmart", href: "/predict" },
  { label: "Pools", href: "/pool" },
  { label: "Analysis", href: "/analysis" },
  { label: "Watchlist", href: "/watchlist" },
];

const WALLET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Full-width explorer bar: wordmark · nav · wallet search · theme · wallet. */
export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [invalid, setInvalid] = useState(false);

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  // "/" focuses the search box from anywhere, like most explorers.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const owner = query.trim();
    if (!WALLET_REGEX.test(owner)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    router.push(`/analysis?owner=${owner}`);
    setQuery("");
    inputRef.current?.blur();
  }

  return (
    <header className="border-rule bg-paper/85 fixed inset-x-0 top-0 z-50 border-b backdrop-blur-xl">
      <div className="mx-auto flex h-[var(--nav-height)] w-full max-w-[var(--page-max)] items-center gap-4 px-[var(--page-gutter)]">
        <Link
          href="/"
          className="text-ink inline-flex shrink-0 items-center gap-2.5 text-[17px] font-semibold tracking-tight"
        >
          <span
            aria-hidden
            className="border-rule-2 bg-paper-2 inline-flex h-9 w-9 items-center justify-center rounded-lg border"
          >
            <Zap className="text-ink h-4 w-4" strokeWidth={2.25} />
          </span>
          CopyPilot
        </Link>

        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {navItems.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-9 items-center rounded-lg px-2.5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150",
                      active
                        ? "text-accent"
                        : "text-ink-2 hover:text-ink hover:bg-paper-3",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <form
          onSubmit={submit}
          role="search"
          className="ml-auto hidden w-full max-w-[18rem] shrink lg:block"
        >
          <label
            className={cn(
              "bg-paper-2 border-rule focus-within:border-rule-2 flex h-10 items-center gap-2 rounded-lg border px-3 transition-colors",
              invalid && "border-danger",
            )}
          >
            <Search className="text-muted h-4 w-4 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (invalid) setInvalid(false);
              }}
              placeholder="Wallet address"
              aria-label="Search by wallet address"
              aria-invalid={invalid || undefined}
              className="text-ink placeholder:text-muted h-full w-full min-w-0 bg-transparent text-sm outline-none"
            />
            <kbd
              aria-hidden
              className="border-rule-2 bg-paper-3 text-muted inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 font-mono text-[11px]"
            >
              /
            </kbd>
          </label>
        </form>

        <div className={cn("flex items-center gap-2", "lg:ml-0 ml-auto")}>
          <ThemeToggle className="hidden sm:inline-flex" />
          <ConnectWalletButton />
        </div>
      </div>
    </header>
  );
}
