"use client";

import { useSyncExternalStore } from "react";

/**
 * A small list of strings persisted in localStorage and shared across
 * components through useSyncExternalStore (favorites, watchlist, ...).
 */
export function createLocalList(key: string, max = 100) {
  const listeners = new Set<() => void>();
  let cache: { raw: string | null; value: string[] } = { raw: null, value: [] };
  const EMPTY: string[] = [];

  function read(): string[] {
    try {
      const raw = localStorage.getItem(key);
      if (raw === cache.raw) return cache.value;
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const value = Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
      cache = { raw, value };
      return value;
    } catch {
      return cache.value;
    }
  }

  function write(next: string[]) {
    try {
      localStorage.setItem(key, JSON.stringify(next.slice(0, max)));
    } catch {
      // storage unavailable
    }
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  }

  return {
    read,
    has: (item: string) => read().includes(item),
    add: (item: string) => {
      const current = read();
      if (!current.includes(item)) write([item, ...current]);
    },
    remove: (item: string) => write(read().filter((entry) => entry !== item)),
    toggle: (item: string) => {
      const current = read();
      write(
        current.includes(item)
          ? current.filter((entry) => entry !== item)
          : [item, ...current],
      );
    },
    useList: () => useSyncExternalStore(subscribe, read, () => EMPTY),
  };
}

export const watchlist = createLocalList("wallet-watchlist", 50);
/** Polymarket traders followed on PredictSmart (Polygon addresses). */
export const predictWatchlist = createLocalList("predict-watchlist", 50);
/** Polymarket Perps accounts followed on the Perp tab. */
export const perpWatchlist = createLocalList("perp-watchlist", 50);
