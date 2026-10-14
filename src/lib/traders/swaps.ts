import type { JsonTransaction, TokenBalance } from "@/lib/api/solana-rpc";

/**
 * Turns a raw Solana transaction into a swap event by looking at what the
 * signer's balances did: tokens in and quote (SOL / USDC / USDT) out is a buy,
 * the reverse is a sell. This is venue-agnostic (pump.fun, PumpSwap, Raydium,
 * Meteora, Orca, Jupiter routes) and needs no program-specific decoding.
 */

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const QUOTE_MINTS = new Set([WSOL_MINT, USDC_MINT, USDT_MINT]);

export type QuoteMint = typeof WSOL_MINT | typeof USDC_MINT | typeof USDT_MINT;

export interface SwapEvent {
  signature: string;
  slot: number;
  /** Unix seconds. */
  blockTime: number;
  wallet: string;
  mint: string;
  side: "buy" | "sell";
  /** Token amount moved (always positive, in UI units). */
  tokenAmount: number;
  tokenDecimals: number;
  quoteMint: QuoteMint;
  /** Quote amount moved (always positive, in UI units). */
  quoteAmount: number;
  /** USD value of the quote leg at trade time. */
  quoteUsd: number;
  /** USD per token at trade time. */
  priceUsd: number;
}

export interface ExtractOptions {
  /** Only report swaps of this mint; otherwise every non-quote mint moved. */
  mint?: string;
  /** SOL/USD at the transaction's block time. */
  solPriceUsd: number;
}

interface OwnerDelta {
  delta: number;
  decimals: number;
}

const MIN_QUOTE_USD = 0.25;
const MIN_SOL = 0.0005;
const LAMPORTS = 1e9;

function scaled(balance: TokenBalance): number {
  const amount = Number(balance.uiTokenAmount.amount);
  if (!Number.isFinite(amount)) return 0;
  return amount / 10 ** balance.uiTokenAmount.decimals;
}

/** Net token movement per (owner, mint) from pre/post token balances. */
function tokenDeltas(
  tx: JsonTransaction,
): Map<string, Map<string, OwnerDelta>> {
  const byOwner = new Map<string, Map<string, OwnerDelta>>();
  const bump = (balance: TokenBalance, sign: 1 | -1) => {
    if (!balance.owner) return;
    const mints = byOwner.get(balance.owner) ?? new Map<string, OwnerDelta>();
    const entry = mints.get(balance.mint) ?? {
      delta: 0,
      decimals: balance.uiTokenAmount.decimals,
    };
    entry.delta += sign * scaled(balance);
    mints.set(balance.mint, entry);
    byOwner.set(balance.owner, mints);
  };
  for (const balance of tx.meta?.preTokenBalances ?? []) bump(balance, -1);
  for (const balance of tx.meta?.postTokenBalances ?? []) bump(balance, 1);
  return byOwner;
}

function quoteUsdValue(mint: QuoteMint, amount: number, solPriceUsd: number) {
  return mint === WSOL_MINT ? amount * solPriceUsd : amount;
}

/**
 * Extracts the swaps a signer made in `tx`. Returns an empty list for failed
 * transactions, transfers, LP operations and bot transactions where the fee
 * payer never touches the token.
 */
export function extractSwaps(
  tx: JsonTransaction,
  options: ExtractOptions,
): SwapEvent[] {
  const meta = tx.meta;
  if (!meta || meta.err || tx.blockTime == null) return [];
  const message = tx.transaction.message;
  const signers = message.accountKeys.slice(
    0,
    Math.max(1, message.header.numRequiredSignatures),
  );
  const deltas = tokenDeltas(tx);
  const events: SwapEvent[] = [];

  signers.forEach((signer, signerIndex) => {
    const mints = deltas.get(signer);
    if (!mints) return;

    const lamports =
      (meta.postBalances[signerIndex] ?? 0) -
      (meta.preBalances[signerIndex] ?? 0) +
      (signerIndex === 0 ? meta.fee : 0);
    const quote: Record<QuoteMint, number> = {
      [WSOL_MINT]: lamports / LAMPORTS + (mints.get(WSOL_MINT)?.delta ?? 0),
      [USDC_MINT]: mints.get(USDC_MINT)?.delta ?? 0,
      [USDT_MINT]: mints.get(USDT_MINT)?.delta ?? 0,
    };

    const candidates = options.mint
      ? [options.mint]
      : Array.from(mints.keys()).filter((mint) => !QUOTE_MINTS.has(mint));

    for (const mint of candidates) {
      const token = mints.get(mint);
      if (!token || Math.abs(token.delta) <= 0) continue;
      const side: "buy" | "sell" = token.delta > 0 ? "buy" : "sell";
      const wantSign = side === "buy" ? -1 : 1;

      // Pick the quote leg that moved the opposite way and is worth the most.
      let best: { mint: QuoteMint; amount: number; usd: number } | null = null;
      for (const quoteMint of [
        WSOL_MINT,
        USDC_MINT,
        USDT_MINT,
      ] as QuoteMint[]) {
        const amount = quote[quoteMint];
        if (Math.sign(amount) !== wantSign) continue;
        const abs = Math.abs(amount);
        const usd = quoteUsdValue(quoteMint, abs, options.solPriceUsd);
        if (!best || usd > best.usd)
          best = { mint: quoteMint, amount: abs, usd };
      }
      if (!best) continue;
      if (best.usd < MIN_QUOTE_USD) continue;
      if (best.mint === WSOL_MINT) {
        // Rent for a fresh token account is ~0.002 SOL; a real trade moves more.
        const feeSol = meta.fee / LAMPORTS;
        if (best.amount < MIN_SOL || best.amount < feeSol * 3) continue;
      }

      const tokenAmount = Math.abs(token.delta);
      events.push({
        signature: tx.transaction.signatures[0] ?? "",
        slot: tx.slot,
        blockTime: tx.blockTime as number,
        wallet: signer,
        mint,
        side,
        tokenAmount,
        tokenDecimals: token.decimals,
        quoteMint: best.mint,
        quoteAmount: best.amount,
        quoteUsd: best.usd,
        priceUsd: best.usd / tokenAmount,
      });
    }
  });

  return events;
}
