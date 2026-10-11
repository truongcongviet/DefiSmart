import type { AccountNetwork } from "@/lib/chains";
import { cn } from "@/lib/utils";

/** Flat, brand-neutral tiles for the two networks. Mono glyphs, no gradients. */
export function NetworkMark({
  network,
  className,
}: {
  network: AccountNetwork;
  className?: string;
}) {
  const solana = network === "solana";

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[10px] border font-mono text-[11px] font-semibold tracking-wide",
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
