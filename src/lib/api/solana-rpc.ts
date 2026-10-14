import axios from "axios";

/**
 * Minimal Solana JSON-RPC client used to discover LP position accounts for a
 * pool. Defaults to the public mainnet endpoint; set `SOLANA_RPC_URL` for a
 * private RPC (Helius, Triton, ...) when you need higher limits.
 */

export const DLMM_PROGRAM_ID = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
export const DAMM_V2_PROGRAM_ID = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
const RPC_TIMEOUT_MS = 45_000;
const RPC_MAX_RETRIES = 5;
/**
 * The public endpoint allows only a handful of getProgramAccounts calls per
 * window, so heavy methods are serialized with a minimum gap between them.
 * Private RPCs (SOLANA_RPC_URL) skip the gap.
 */
const HEAVY_METHODS = new Set(["getProgramAccounts"]);
const HEAVY_MIN_GAP_MS = 1_100;

export function getRpcUrl(): string {
  const configured = process.env.SOLANA_RPC_URL?.trim();
  return configured || DEFAULT_RPC_URL;
}

export function isPublicRpc(): boolean {
  return getRpcUrl() === DEFAULT_RPC_URL;
}

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

interface RpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let heavyChain: Promise<void> = Promise.resolve();
let lastHeavyAt = 0;

/** Runs `task` after the previous heavy call, keeping HEAVY_MIN_GAP_MS between them. */
function throttleHeavy<T>(task: () => Promise<T>): Promise<T> {
  const run = heavyChain.then(async () => {
    const wait = lastHeavyAt + HEAVY_MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastHeavyAt = Date.now();
  });
  heavyChain = run.catch(() => undefined);
  return run.then(task);
}

function backoffMs(attempt: number, retryAfter?: string) {
  const header = Number(retryAfter);
  if (Number.isFinite(header) && header > 0) return header * 1_000;
  return Math.min(15_000, 1_200 * 2 ** attempt);
}

export async function rpcCall<T>(
  method: string,
  params: unknown[],
): Promise<T> {
  const heavy = HEAVY_METHODS.has(method) && isPublicRpc();
  const attemptCall = async (): Promise<T> => {
    const response = await axios.post<RpcResponse<T>>(
      getRpcUrl(),
      { jsonrpc: "2.0", id: 1, method, params },
      { timeout: RPC_TIMEOUT_MS },
    );
    const body = response.data;
    if (body.error) {
      throw new RpcError(body.error.message, body.error.code);
    }
    return body.result as T;
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= RPC_MAX_RETRIES; attempt += 1) {
    try {
      return heavy ? await throttleHeavy(attemptCall) : await attemptCall();
    } catch (error) {
      lastError = error;
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : error instanceof RpcError
          ? error.code
          : undefined;
      if (status !== 429 || attempt === RPC_MAX_RETRIES) {
        throw error;
      }
      const retryAfter = axios.isAxiosError(error)
        ? (error.response?.headers?.["retry-after"] as string | undefined)
        : undefined;
      lastHeavyAt = Date.now();
      await sleep(backoffMs(attempt, retryAfter));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("RPC request failed");
}

// ---------------------------------------------------------------------------
// base58 (Solana public keys)
// ---------------------------------------------------------------------------

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros += 1;
  }

  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let output = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    output += BASE58_ALPHABET[digits[i]];
  }
  return output;
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

// ---------------------------------------------------------------------------
// Program account discovery
// ---------------------------------------------------------------------------

interface ProgramAccountSlice {
  pubkey: string;
  account: { data: [string, string]; space?: number; owner?: string };
}

async function getProgramAccountsSlice(
  programId: string,
  filters: unknown[],
  sliceOffset: number,
  sliceLength: number,
): Promise<ProgramAccountSlice[]> {
  const result = await rpcCall<ProgramAccountSlice[]>("getProgramAccounts", [
    programId,
    {
      encoding: "base64",
      dataSlice: { offset: sliceOffset, length: sliceLength },
      filters,
    },
  ]);
  return Array.isArray(result) ? result : [];
}

export interface PoolPositionAccount {
  position: string;
  owner: string;
}

/** Minimum account size of a DLMM position (PositionV2 = 8120 bytes). */
const DLMM_MIN_POSITION_SIZE = 8120;

/**
 * Open DLMM positions of a pool. Position accounts store `lb_pair` at byte 8
 * and `owner` at byte 40 (after the 8-byte Anchor discriminator).
 */
export async function getDlmmPoolPositions(
  pool: string,
): Promise<PoolPositionAccount[]> {
  const accounts = await getProgramAccountsSlice(
    DLMM_PROGRAM_ID,
    [{ memcmp: { offset: 8, bytes: pool } }],
    40,
    32,
  );

  return accounts
    .filter(
      (item) =>
        (item.account.space ?? DLMM_MIN_POSITION_SIZE) >=
        DLMM_MIN_POSITION_SIZE,
    )
    .map((item) => ({
      position: item.pubkey,
      owner: encodeBase58(base64ToBytes(item.account.data[0])),
    }));
}

/** DAMM v2 position account size (cp-amm `Position`). */
const DAMM_V2_POSITION_SIZE = 408;

/**
 * Open DAMM v2 positions of a pool. The position stores `pool` at byte 8 and
 * `nft_mint` at byte 40; the owner is whoever holds that NFT, so resolving it
 * takes one extra lookup per position on the token program.
 */
export async function getDammV2PoolPositions(
  pool: string,
): Promise<{ positions: PoolPositionAccount[]; unresolved: number }> {
  const accounts = await getProgramAccountsSlice(
    DAMM_V2_PROGRAM_ID,
    [
      { dataSize: DAMM_V2_POSITION_SIZE },
      { memcmp: { offset: 8, bytes: pool } },
    ],
    40,
    32,
  );

  const positions: PoolPositionAccount[] = [];
  let unresolved = 0;

  for (const item of accounts) {
    const nftMint = encodeBase58(base64ToBytes(item.account.data[0]));
    const owner = await resolveNftOwner(nftMint);
    if (owner) {
      positions.push({ position: item.pubkey, owner });
    } else {
      unresolved += 1;
    }
  }

  return { positions, unresolved };
}

async function resolveNftOwner(mint: string): Promise<string | null> {
  // Token accounts store `mint` at byte 0 and `owner` at byte 32.
  for (const program of [TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID]) {
    try {
      const holders = await getProgramAccountsSlice(
        program,
        [{ memcmp: { offset: 0, bytes: mint } }],
        32,
        32,
      );
      if (holders.length > 0) {
        return encodeBase58(base64ToBytes(holders[0].account.data[0]));
      }
    } catch {
      // fall through to the next program / give up
    }
  }

  try {
    const largest = await rpcCall<{ value: Array<{ address: string }> }>(
      "getTokenLargestAccounts",
      [mint],
    );
    const tokenAccount = largest?.value?.[0]?.address;
    if (!tokenAccount) {
      return null;
    }
    const info = await rpcCall<{
      value: { data: { parsed?: { info?: { owner?: string } } } } | null;
    }>("getAccountInfo", [tokenAccount, { encoding: "jsonParsed" }]);
    return info?.value?.data?.parsed?.info?.owner ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Transaction history (swap discovery)
// ---------------------------------------------------------------------------

/**
 * The default public endpoint allows only a handful of `getTransaction` calls
 * per window, which makes swap history unusable. Allnodes' public RPC serves
 * transaction history freely (~30 req/s per IP measured) but disables
 * getProgramAccounts, so history uses its own endpoint. Override with
 * `SOLANA_TX_RPC_URL` (any private RPC works too) and `SOLANA_TX_RPS`.
 */
const DEFAULT_TX_RPC_URL = "https://solana-rpc.publicnode.com";
const TX_CONCURRENCY = 8;
const TX_DEFAULT_RPS = 25;
const TX_MAX_RETRIES = 6;

export function getTxRpcUrl(): string {
  const configured = process.env.SOLANA_TX_RPC_URL?.trim();
  return configured || DEFAULT_TX_RPC_URL;
}

function txRps(): number {
  const raw = Number(process.env.SOLANA_TX_RPS);
  return Number.isFinite(raw) && raw > 0 ? raw : TX_DEFAULT_RPS;
}

let txInflight = 0;
const txQueue: Array<() => void> = [];
/** Token bucket: refills at `txRps()` per second, burst = 1 s worth. */
let txTokens = 0;
let txLastRefill = Date.now();
/** Set after a 429 so every caller backs off together. */
let txPausedUntil = 0;

async function takeTxToken() {
  for (;;) {
    const now = Date.now();
    if (txPausedUntil > now) {
      await sleep(txPausedUntil - now);
      continue;
    }
    const rps = txRps();
    txTokens = Math.min(rps, txTokens + ((now - txLastRefill) / 1000) * rps);
    txLastRefill = now;
    if (txTokens >= 1) {
      txTokens -= 1;
      return;
    }
    await sleep(Math.ceil(((1 - txTokens) / rps) * 1000));
  }
}

function acquireTxSlot(): Promise<void> {
  if (txInflight < TX_CONCURRENCY) {
    txInflight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    txQueue.push(() => {
      txInflight += 1;
      resolve();
    });
  });
}

function releaseTxSlot() {
  txInflight -= 1;
  const next = txQueue.shift();
  if (next) next();
}

function txBackoffMs(attempt: number, retryAfter?: string) {
  const header = Number(retryAfter);
  if (Number.isFinite(header) && header > 0) return header * 1_000;
  return Math.min(4_000, 400 * 2 ** attempt);
}

/** JSON-RPC call against the transaction-history endpoint, with retries. */
export async function rpcCallTx<T>(
  method: string,
  params: unknown[],
): Promise<T> {
  await acquireTxSlot();
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt <= TX_MAX_RETRIES; attempt += 1) {
      await takeTxToken();
      try {
        const response = await axios.post<RpcResponse<T>>(
          getTxRpcUrl(),
          { jsonrpc: "2.0", id: 1, method, params },
          { timeout: RPC_TIMEOUT_MS },
        );
        const body = response.data;
        if (body.error) throw new RpcError(body.error.message, body.error.code);
        return body.result as T;
      } catch (error) {
        lastError = error;
        const status = axios.isAxiosError(error)
          ? (error.response?.status ?? 503)
          : error instanceof RpcError
            ? error.code
            : undefined;
        const rateLimited = status === 429 || status === -32005;
        const retryable =
          rateLimited || (typeof status === "number" && status >= 500);
        if (!retryable || attempt === TX_MAX_RETRIES) throw error;
        const retryAfter = axios.isAxiosError(error)
          ? (error.response?.headers?.["retry-after"] as string | undefined)
          : undefined;
        const wait = txBackoffMs(attempt, retryAfter);
        if (rateLimited) {
          // Everyone waits, and the bucket restarts empty.
          txPausedUntil = Math.max(txPausedUntil, Date.now() + wait);
          txTokens = 0;
        } else {
          await sleep(wait);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("RPC failed");
  } finally {
    releaseTxSlot();
  }
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown | null;
}

/** Signatures touching `address`, newest first (≤ 1000 per call). */
export async function getSignaturesForAddress(
  address: string,
  options: { limit?: number; before?: string; until?: string } = {},
): Promise<SignatureInfo[]> {
  const config: Record<string, unknown> = {
    limit: Math.max(1, Math.min(1000, options.limit ?? 1000)),
    commitment: "confirmed",
  };
  if (options.before) config.before = options.before;
  if (options.until) config.until = options.until;
  const result = await rpcCallTx<SignatureInfo[]>("getSignaturesForAddress", [
    address,
    config,
  ]);
  return Array.isArray(result) ? result : [];
}

export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export interface JsonTransaction {
  slot: number;
  blockTime: number | null;
  version?: number | "legacy";
  meta: {
    err: unknown | null;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    loadedAddresses?: { writable: string[]; readonly: string[] };
    logMessages?: string[];
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: string[];
      header: { numRequiredSignatures: number };
      instructions: Array<{ programIdIndex: number; accounts: number[] }>;
    };
  };
}

/** Fetches a transaction in `json` encoding; null when the node has pruned it. */
export async function getTransaction(
  signature: string,
): Promise<JsonTransaction | null> {
  return rpcCallTx<JsonTransaction | null>("getTransaction", [
    signature,
    {
      encoding: "json",
      maxSupportedTransactionVersion: 1,
      commitment: "confirmed",
    },
  ]);
}

/** Fetches many transactions, keeping TX_CONCURRENCY requests in flight. */
export async function getTransactions(
  signatures: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Array<JsonTransaction | null>> {
  let done = 0;
  return Promise.all(
    signatures.map(async (signature) => {
      try {
        return await getTransaction(signature);
      } catch {
        return null;
      } finally {
        done += 1;
        onProgress?.(done, signatures.length);
      }
    }),
  );
}
