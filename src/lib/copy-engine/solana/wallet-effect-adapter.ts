import { intentId } from "../ids";
import type { CopyAdapter } from "../ports";
import type { CopyIntent, ObservedTransaction } from "../types";

export interface SolanaWalletEffectPayload {
  programIds: string[];
  assetDeltas: ObservedTransaction["assetDeltas"];
}

export class SolanaWalletEffectAdapter implements CopyAdapter {
  readonly id = "solana-wallet-effect";
  readonly version = 1;

  async decode(transaction: ObservedTransaction) {
    if (transaction.chain !== "solana") return [];
    if (transaction.assetDeltas.length === 0) return [];

    const intent: CopyIntent<SolanaWalletEffectPayload> = {
      id: intentId({
        transaction,
        adapterId: this.id,
        adapterVersion: this.version,
        sourceIndex: 0,
        kind: "WALLET_EFFECT",
      }),
      adapterId: this.id,
      adapterVersion: this.version,
      chain: transaction.chain,
      leaderWallet: transaction.leaderWallet,
      sourceTransactionId: transaction.id,
      sourceSignature: transaction.signature,
      sourceIndex: 0,
      kind: "WALLET_EFFECT",
      actionability: "observable",
      confidence: 1,
      createdAt: transaction.observedAt,
      payload: {
        programIds: transaction.programIds,
        assetDeltas: transaction.assetDeltas,
      },
    };

    return [intent];
  }

  async plan() {
    return null;
  }
}
