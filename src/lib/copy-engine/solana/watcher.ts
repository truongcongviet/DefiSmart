import type { CopyCommitment } from "../types";

export interface SolanaLogNotification {
  leaderWallet: string;
  signature: string;
  slot: number;
  error: unknown | null;
  logs: string[];
}

export interface SolanaLogsWatcherOptions {
  wsUrl: string;
  leaders: string[];
  commitment?: CopyCommitment;
  reconnectDelayMs?: number;
  onError?: (error: unknown) => void;
}

interface RpcEnvelope {
  id?: number;
  result?: number;
  error?: { code: number; message: string };
  method?: string;
  params?: {
    subscription: number;
    result: {
      context: { slot: number };
      value: {
        signature: string;
        err: unknown | null;
        logs: string[];
      };
    };
  };
}

export class SolanaLogsWatcher {
  private socket?: WebSocket;
  private stopped = true;
  private requestId = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private handler?: (notification: SolanaLogNotification) => Promise<void>;
  private readonly pendingLeaders = new Map<number, string>();
  private readonly subscriptionLeaders = new Map<number, string>();
  private readonly commitment: CopyCommitment;
  private readonly reconnectDelayMs: number;

  constructor(private readonly options: SolanaLogsWatcherOptions) {
    this.commitment = options.commitment ?? "confirmed";
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  }

  async start(handler: (notification: SolanaLogNotification) => Promise<void>) {
    if (!this.stopped) throw new Error("SolanaLogsWatcher is already running");
    this.stopped = false;
    this.handler = handler;
    try {
      await this.connect();
    } catch (error) {
      this.stopped = true;
      this.socket?.close();
      this.socket = undefined;
      throw error;
    }
  }

  async stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.pendingLeaders.clear();
    this.subscriptionLeaders.clear();
    this.socket?.close(1000, "copy worker stopped");
    this.socket = undefined;
  }

  private connect() {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.options.wsUrl);
      this.socket = socket;
      let opened = false;

      socket.addEventListener("open", () => {
        opened = true;
        this.pendingLeaders.clear();
        this.subscriptionLeaders.clear();
        for (const leader of new Set(this.options.leaders)) {
          this.subscribe(socket, leader);
        }
        resolve();
      });

      socket.addEventListener("message", (event) => {
        try {
          this.onMessage(String(event.data));
        } catch (error) {
          this.options.onError?.(error);
        }
      });

      socket.addEventListener("error", () => {
        const error = new Error("Solana WebSocket connection error");
        this.options.onError?.(error);
        if (!opened) reject(error);
      });

      socket.addEventListener("close", () => {
        if (!this.stopped) {
          this.reconnectTimer = setTimeout(() => {
            void this.connect().catch((error) => this.options.onError?.(error));
          }, this.reconnectDelayMs);
        }
      });
    });
  }

  private subscribe(socket: WebSocket, leaderWallet: string) {
    const id = ++this.requestId;
    this.pendingLeaders.set(id, leaderWallet);
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "logsSubscribe",
        params: [{ mentions: [leaderWallet] }, { commitment: this.commitment }],
      }),
    );
  }

  private onMessage(raw: string) {
    const message = JSON.parse(raw) as RpcEnvelope;

    if (message.id !== undefined) {
      const leader = this.pendingLeaders.get(message.id);
      this.pendingLeaders.delete(message.id);
      if (message.error) {
        throw new Error(
          `logsSubscribe ${message.error.code}: ${message.error.message}`,
        );
      }
      if (leader && typeof message.result === "number") {
        this.subscriptionLeaders.set(message.result, leader);
      }
      return;
    }

    if (message.method !== "logsNotification" || !message.params) return;
    const leader = this.subscriptionLeaders.get(message.params.subscription);
    if (!leader || !this.handler) return;

    const { context, value } = message.params.result;
    void this.handler({
      leaderWallet: leader,
      signature: value.signature,
      slot: context.slot,
      error: value.err,
      logs: value.logs,
    }).catch((error) => this.options.onError?.(error));
  }
}
