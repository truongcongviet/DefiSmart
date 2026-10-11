"use client";

import { useState } from "react";

import { NETWORKS, type AccountNetwork } from "@/lib/chains";
import { cn } from "@/lib/utils";

/**
 * Chain logo tile. Falls back to a mono glyph tile if the asset fails to load,
 * so the layout never collapses.
 */
export function NetworkMark({
  network,
  className,
}: {
  network: AccountNetwork;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const info = NETWORKS[network];
  const solana = network === "solana";

  if (!broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={info.logo}
        alt={`${info.label} logo`}
        width={40}
        height={40}
        draggable={false}
        onError={() => setBroken(true)}
        className={cn(
          "border-rule bg-paper-3 inline-block shrink-0 rounded-full border object-cover select-none",
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-semibold tracking-wide",
        solana
          ? "border-[oklch(40%_0.07_295)] bg-[oklch(26%_0.05_295)] text-[oklch(88%_0.06_295)]"
          : "border-[oklch(40%_0.07_135)] bg-[oklch(26%_0.05_135)] text-[oklch(88%_0.08_135)]",
        className,
      )}
    >
      {solana ? "SOL" : "RH"}
    </span>
  );
}
