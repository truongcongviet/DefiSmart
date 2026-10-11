import { observationId } from "../ids";
import type { AssetDelta, CopyCommitment, ObservedTransaction } from "../types";
import type {
  SolanaParsedAccountKey,
  SolanaParsedInstruction,
  SolanaRpcTransaction,
  SolanaTokenBalance,
} from "./types";

export interface NormalizeSolanaTransactionOptions {
  leaderWallet: string;
  commitment: CopyCommitment;
  observedAt?: Date;
}

export function normalizeSolanaTransaction(
  raw: SolanaRpcTransaction,
  options: NormalizeSolanaTransactionOptions,
): ObservedTransaction<SolanaRpcTransaction> {
  const accountKeys = raw.transaction.message.accountKeys.map((entry) =>
    typeof entry === "string" ? entry : entry.pubkey,
  );
  const numRequiredSignatures =
    raw.transaction.message.header?.numRequiredSignatures ?? 0;
  const leaderSigned = raw.transaction.message.accountKeys.some(
    (entry, index) =>
      accountPubkey(entry) === options.leaderWallet &&
      accountIsSigner(entry, index, numRequiredSignatures),
  );
  const signature = raw.transaction.signatures[0];

  if (!signature) {
    throw new Error("Solana transaction has no signature");
  }

  return {
    id: observationId("solana", options.leaderWallet, signature),
    chain: "solana",
    signature,
    slot: raw.slot,
    commitment: options.commitment,
    leaderWallet: options.leaderWallet,
    leaderSigned,
    success: raw.meta?.err === null,
    observedAt: (options.observedAt ?? new Date()).toISOString(),
    blockTime:
      raw.blockTime === null
        ? undefined
        : new Date(raw.blockTime * 1_000).toISOString(),
    feeRaw: raw.meta ? String(raw.meta.fee) : undefined,
    accountKeys,
    programIds: collectProgramIds(raw),
    assetDeltas: collectAssetDeltas(raw, options.leaderWallet, accountKeys),
    raw,
  };
}

function accountPubkey(entry: string | SolanaParsedAccountKey) {
  return typeof entry === "string" ? entry : entry.pubkey;
}

function accountIsSigner(
  entry: string | SolanaParsedAccountKey,
  index: number,
  numRequiredSignatures: number,
) {
  return typeof entry === "string"
    ? index < numRequiredSignatures
    : entry.signer;
}

function collectProgramIds(raw: SolanaRpcTransaction) {
  const programIds = new Set<string>();
  const addInstructions = (instructions: SolanaParsedInstruction[]) => {
    for (const instruction of instructions) {
      if (instruction.programId) programIds.add(instruction.programId);
    }
  };

  addInstructions(raw.transaction.message.instructions);
  for (const group of raw.meta?.innerInstructions ?? []) {
    addInstructions(group.instructions);
  }

  return [...programIds];
}

function collectAssetDeltas(
  raw: SolanaRpcTransaction,
  leaderWallet: string,
  accountKeys: string[],
) {
  const deltas: AssetDelta[] = [];
  const meta = raw.meta;
  if (!meta) return deltas;

  let nativeDelta = BigInt(0);
  for (let index = 0; index < accountKeys.length; index++) {
    if (accountKeys[index] !== leaderWallet) continue;
    const before = BigInt(meta.preBalances[index] ?? 0);
    const after = BigInt(meta.postBalances[index] ?? 0);
    nativeDelta += after - before;
  }

  if (nativeDelta !== BigInt(0)) {
    deltas.push({
      assetId: "SOL",
      assetType: "native",
      decimals: 9,
      owner: leaderWallet,
      rawDelta: nativeDelta.toString(),
    });
  }

  const before = aggregateTokenBalances(
    meta.preTokenBalances ?? [],
    leaderWallet,
    accountKeys,
  );
  const after = aggregateTokenBalances(
    meta.postTokenBalances ?? [],
    leaderWallet,
    accountKeys,
  );
  const mints = new Set([...before.keys(), ...after.keys()]);

  for (const mint of mints) {
    const pre = before.get(mint);
    const post = after.get(mint);
    const delta = (post?.amount ?? BigInt(0)) - (pre?.amount ?? BigInt(0));
    if (delta === BigInt(0)) continue;

    deltas.push({
      assetId: mint,
      assetType: "token",
      decimals: post?.decimals ?? pre?.decimals ?? 0,
      owner: leaderWallet,
      rawDelta: delta.toString(),
      tokenAccounts: [
        ...new Set([...(pre?.accounts ?? []), ...(post?.accounts ?? [])]),
      ],
    });
  }

  return deltas;
}

function aggregateTokenBalances(
  balances: SolanaTokenBalance[],
  leaderWallet: string,
  accountKeys: string[],
) {
  const result = new Map<
    string,
    { amount: bigint; decimals: number; accounts: string[] }
  >();

  for (const balance of balances) {
    if (balance.owner !== leaderWallet) continue;
    const existing = result.get(balance.mint) ?? {
      amount: BigInt(0),
      decimals: balance.uiTokenAmount.decimals,
      accounts: [],
    };
    existing.amount += BigInt(balance.uiTokenAmount.amount);
    existing.decimals = balance.uiTokenAmount.decimals;
    const tokenAccount = accountKeys[balance.accountIndex];
    if (tokenAccount) existing.accounts.push(tokenAccount);
    result.set(balance.mint, existing);
  }

  return result;
}
