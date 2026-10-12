/** Shared class recipes so every control speaks the same voice. */

export const button = {
  base: "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,opacity] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-55",
  primary: "bg-accent text-accent-ink hover:bg-focus",
  outline:
    "border border-rule-2 text-ink hover:border-neutral hover:bg-paper-3",
  ghost: "text-ink-2 hover:bg-paper-3 hover:text-ink",
  subtle: "bg-paper-3 text-ink hover:bg-paper-4",
  small: "h-9 px-3.5",
} as const;

export const input =
  "h-11 w-full min-w-0 rounded-input border border-rule bg-paper-2 px-3.5 text-sm text-ink placeholder:text-muted outline-2 outline-offset-1 outline-transparent transition-[border-color,background-color,outline-color] duration-150 hover:border-rule-2 focus-visible:border-rule-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-55";

export const panel = "rounded-card border border-rule bg-paper-2";

export const helperSlot = "min-h-[1.25rem] text-xs leading-5";
