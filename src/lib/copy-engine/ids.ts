import type {
  CopyIntent,
  CopySubscription,
  ObservedTransaction,
} from "./types";

function encodePart(value: string) {
  return encodeURIComponent(value);
}

export function observationId(
  chain: string,
  leaderWallet: string,
  signature: string,
) {
  return [chain, leaderWallet, signature].map(encodePart).join(":");
}

export function intentId(input: {
  transaction: ObservedTransaction;
  adapterId: string;
  adapterVersion: number;
  sourceIndex: number;
  kind: string;
}) {
  return [
    input.transaction.id,
    input.adapterId,
    `v${input.adapterVersion}`,
    input.sourceIndex.toString(),
    input.kind,
  ]
    .map(encodePart)
    .join(":");
}

export function copyJobId(
  intent: Pick<CopyIntent, "id">,
  subscription: Pick<CopySubscription, "id">,
) {
  return [intent.id, subscription.id].map(encodePart).join(":");
}

export function copyPlanId(jobId: string) {
  return `${jobId}:plan`;
}
