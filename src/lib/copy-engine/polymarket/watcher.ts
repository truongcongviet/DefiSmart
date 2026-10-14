import {
  fetchActivity,
  fetchOpenPositions,
} from "@/lib/predict/polymarket-api";

import type { ObservedTransaction } from "../types";
import { normalizePolymarketActivity } from "./normalize";
import type { PolymarketTradePayload } from "./types";

/**
 * Watches leaders' fills on Polymarket as close to real time as the public
 * APIs allow:
 *
 * - The CLOB market websocket announces every fill on the markets the leaders
 *   hold (`last_trade_price`), usually within a second. It carries no wallet,
 *   so a hit only triggers an immediate activity poll for the leaders in that
 *   market.
 * - Every leader's activity feed is polled on a short interval regardless, so
 *   nothing is missed when the socket drops or a leader opens a new market.
 */

const CLOB_MARKET_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

export interface PolymarketWatcherOptions {
  leaders: string[];
  /** Regular poll interval per leader, ms. */
  pollIntervalMs?: number;
  /** How often the leaders' open markets are refreshed for socket subscriptions, ms. */
  marketRefreshMs?: number;
  /** Disable the websocket trigger (poll only). */
  websocket?: boolean;
  onError?: (error: unknown) => void;
  onLog?: (message: string) => void;
}

type Handler = (
  transaction: ObservedTransaction<PolymarketTradePayload>,
) => Promise<void>;

interface WsTradeEvent {
  event_type?: string;
  market?: string;
  asset_id?: string;
}

export class PolymarketActivityWatcher {
  private stopped = true;
  private handler?: Handler;
  private readonly leaders: string[];
  private readonly pollIntervalMs: number;
  private readonly marketRefreshMs: number;
  private readonly useWs: boolean;
  /** Newest fill timestamp seen per leader (unix seconds). */
  private readonly cursor = new Map<string, number>();
  private readonly seen = new Set<string>();
  /** conditionId → leaders holding it. */
  private readonly marketLeaders = new Map<string, Set<string>>();
  private socket?: WebSocket;
  private pollTimer?: ReturnType<typeof setInterval>;
  private marketTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly options: PolymarketWatcherOptions) {
    this.leaders = Array.from(
      new Set(options.leaders.map((l) => l.toLowerCase())),
    );
    this.pollIntervalMs = options.pollIntervalMs ?? 4_000;
    this.marketRefreshMs = options.marketRefreshMs ?? 120_000;
    this.useWs = options.websocket ?? true;
  }

  async start(handler: Handler) {
    if (!this.stopped)
      throw new Error("PolymarketActivityWatcher is already running");
    this.stopped = false;
    this.handler = handler;
    // Prime cursors and mark existing fills as seen, so only fills made after
    // start are copied (old ones would be blocked as stale anyway).
    await Promise.all(
      this.leaders.map(async (leader) => {
        try {
          const rows = await fetchActivity(leader, 40);
          let newest = 0;
          for (const row of rows) {
            if (row.type !== "TRADE") continue;
            newest = Math.max(newest, row.timestamp);
            const tx = normalizePolymarketActivity(row, leader);
            if (tx) this.seen.add(tx.id);
          }
          this.cursor.set(leader, newest || Math.floor(Date.now() / 1000));
        } catch (error) {
          this.cursor.set(leader, Math.floor(Date.now() / 1000));
          this.options.onError?.(error);
        }
      }),
    );
    this.pollTimer = setInterval(
      () => void this.pollAll(),
      this.pollIntervalMs,
    );
    if (this.useWs) {
      await this.refreshMarkets();
      this.marketTimer = setInterval(
        () => void this.refreshMarkets(),
        this.marketRefreshMs,
      );
      this.connect();
    }
    this.options.onLog?.(
      `watching ${this.leaders.length} leader(s): poll ${this.pollIntervalMs}ms, websocket ${this.useWs ? "on" : "off"}`,
    );
  }

  async stop() {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.marketTimer) clearInterval(this.marketTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, "watcher stopped");
    this.socket = undefined;
    await Promise.all(this.inflight.values());
  }

  /** Poll one leader now (used by the websocket trigger and the interval). */
  poll(leader: string): Promise<void> {
    const running = this.inflight.get(leader);
    if (running) return running;
    const task = this.pollOnce(leader).finally(() =>
      this.inflight.delete(leader),
    );
    this.inflight.set(leader, task);
    return task;
  }

  private async pollAll() {
    if (this.stopped) return;
    await Promise.all(this.leaders.map((leader) => this.poll(leader)));
  }

  private async pollOnce(leader: string) {
    try {
      const since = this.cursor.get(leader) ?? 0;
      const rows = await fetchActivity(leader, 40);
      const fresh = rows
        .filter((r) => r.type === "TRADE" && r.timestamp >= since)
        .sort((a, b) => a.timestamp - b.timestamp);
      const observedAt = new Date().toISOString();
      for (const row of fresh) {
        const tx = normalizePolymarketActivity(row, leader, observedAt);
        if (!tx || this.seen.has(tx.id)) continue;
        this.seen.add(tx.id);
        if (this.seen.size > 5_000) {
          const keep = Array.from(this.seen).slice(-2_500);
          this.seen.clear();
          keep.forEach((id) => this.seen.add(id));
        }
        this.cursor.set(leader, Math.max(since, row.timestamp));
        const leadersInMarket =
          this.marketLeaders.get(row.conditionId) ?? new Set<string>();
        leadersInMarket.add(leader);
        this.marketLeaders.set(row.conditionId, leadersInMarket);
        await this.handler?.(tx);
      }
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  private async refreshMarkets() {
    if (this.stopped) return;
    const next = new Map<string, Set<string>>();
    const assetIds = new Set<string>();
    for (const leader of this.leaders) {
      try {
        const { rows } = await fetchOpenPositions(leader, 200);
        for (const position of rows) {
          if (!position.conditionId) continue;
          const holders = next.get(position.conditionId) ?? new Set<string>();
          holders.add(leader);
          next.set(position.conditionId, holders);
          if (position.asset) assetIds.add(position.asset);
          if (position.oppositeAsset) assetIds.add(position.oppositeAsset);
        }
      } catch (error) {
        this.options.onError?.(error);
      }
    }
    for (const [market, holders] of next)
      this.marketLeaders.set(market, holders);
    this.subscribedAssets = Array.from(assetIds).slice(0, 500);
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.subscribedAssets.length
    ) {
      this.socket.send(
        JSON.stringify({
          type: "market",
          assets_ids: this.subscribedAssets,
          custom_feature_enabled: true,
        }),
      );
    }
  }

  private subscribedAssets: string[] = [];

  private connect() {
    if (this.stopped) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(CLOB_MARKET_WS);
    } catch (error) {
      this.options.onError?.(error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.subscribedAssets.length) {
        socket.send(
          JSON.stringify({
            type: "market",
            assets_ids: this.subscribedAssets,
            custom_feature_enabled: true,
          }),
        );
      }
      this.options.onLog?.(
        `clob websocket open · ${this.subscribedAssets.length} assets`,
      );
    });
    socket.addEventListener("message", (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      for (const message of Array.isArray(payload) ? payload : [payload]) {
        const trade = message as WsTradeEvent;
        if (trade?.event_type !== "last_trade_price" || !trade.market) continue;
        const holders = this.marketLeaders.get(trade.market);
        if (!holders) continue;
        for (const leader of holders) void this.poll(leader);
      }
    });
    socket.addEventListener("error", () => socket.close());
    socket.addEventListener("close", () => {
      this.socket = undefined;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, 3_000);
  }
}
