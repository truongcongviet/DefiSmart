import type { CopyCommitment } from "../types";
import type { SolanaRpcTransaction } from "./types";

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface SolanaRpcClientOptions {
  httpUrl: string;
  commitment?: Exclude<CopyCommitment, "processed">;
  maxSupportedTransactionVersion?: number;
  fetchImpl?: typeof fetch;
  transactionFetchAttempts?: number;
  transactionFetchDelayMs?: number;
}

export class SolanaRpcClient {
  private requestId = 0;
  private readonly httpUrl: string;
  private readonly commitment: Exclude<CopyCommitment, "processed">;
  private readonly maxSupportedTransactionVersion: number;
  private readonly fetchImpl: typeof fetch;
  private readonly transactionFetchAttempts: number;
  private readonly transactionFetchDelayMs: number;

  constructor(options: SolanaRpcClientOptions) {
    this.httpUrl = options.httpUrl;
    this.commitment = options.commitment ?? "confirmed";
    this.maxSupportedTransactionVersion =
      options.maxSupportedTransactionVersion ?? 1;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.transactionFetchAttempts = options.transactionFetchAttempts ?? 5;
    this.transactionFetchDelayMs = options.transactionFetchDelayMs ?? 250;
  }

  async getTransaction(signature: string) {
    for (let attempt = 1; attempt <= this.transactionFetchAttempts; attempt++) {
      const transaction = await this.request<SolanaRpcTransaction | null>(
        "getTransaction",
        [
          signature,
          {
            commitment: this.commitment,
            encoding: "jsonParsed",
            maxSupportedTransactionVersion: this.maxSupportedTransactionVersion,
          },
        ],
      );

      if (transaction) return transaction;
      if (attempt < this.transactionFetchAttempts) {
        await delay(this.transactionFetchDelayMs * attempt);
      }
    }

    return null;
  }

  private async request<T>(method: string, params: unknown[]): Promise<T> {
    const id = ++this.requestId;
    const response = await this.fetchImpl(this.httpUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });

    if (!response.ok) {
      throw new Error(`Solana RPC ${response.status}: ${response.statusText}`);
    }

    const payload = (await response.json()) as JsonRpcResponse<T>;
    if (payload.error) {
      throw new Error(
        `Solana RPC ${payload.error.code}: ${payload.error.message}`,
      );
    }
    if (!("result" in payload)) {
      throw new Error(`Solana RPC returned no result for ${method}`);
    }

    return payload.result as T;
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
