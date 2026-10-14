"use client";

import { Activity, Target } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/** Prediction / Perp switch at the top of /predict. */
export function PredictTabs({ active }: { active: "prediction" | "perp" }) {
  const items = [
    {
      key: "prediction",
      label: "Prediction markets",
      href: "/predict",
      icon: Target,
    },
    { key: "perp", label: "Perps", href: "/predict?tab=perp", icon: Activity },
  ] as const;
  return (
    <nav
      aria-label="PredictSmart sections"
      className="bg-paper-3 inline-flex h-10 w-fit items-center rounded-lg p-0.5"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-sm transition-colors",
              isActive
                ? "bg-paper text-ink shadow-sm"
                : "text-muted hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
