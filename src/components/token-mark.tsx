"use client";

import { useState } from "react";

import type { TokenBrand } from "@/lib/chains";
import { cn } from "@/lib/utils";

/** Round token logo with an initial-letter fallback. */
export function TokenMark({
  token,
  className,
}: {
  token: Pick<TokenBrand, "symbol" | "logo">;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  if (!broken && token.logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={token.logo}
        alt={`${token.symbol} logo`}
        width={20}
        height={20}
        draggable={false}
        loading="lazy"
        onError={() => setBroken(true)}
        className={cn(
          "border-rule bg-paper-3 inline-block h-5 w-5 shrink-0 rounded-full border object-cover select-none",
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "border-rule bg-paper-3 text-ink-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] font-semibold",
        className,
      )}
    >
      {token.symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * Inline list of funding tokens: logo + symbol per token, joined by "or".
 * Reads as a sentence fragment so it drops into existing copy.
 */
export function TokenList({
  tokens,
  className,
  markClassName,
}: {
  tokens: TokenBrand[];
  className?: string;
  markClassName?: string;
}) {
  return (
    <span
      className={cn("inline-flex flex-wrap items-center gap-1.5", className)}
    >
      {tokens.map((token, index) => (
        <span key={token.symbol} className="inline-flex items-center gap-1.5">
          {index > 0 && <span className="text-muted">or</span>}
          <TokenMark token={token} className={markClassName} />
          <span className="font-mono">{token.symbol}</span>
        </span>
      ))}
    </span>
  );
}
