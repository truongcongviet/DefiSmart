export type ChainId = "solana" | (string & {});

export type CopyCommitment = "processed" | "confirmed" | "finalized";

export interface AssetDelta {
  assetId: string;
  assetType: "native" | "token";
  decimals: number;
  owner: string;
  rawDelta: string;
  tokenAccounts?: string[];
}

export interface ObservedTransaction<TRaw = unknown> {
  id: string;
  chain: ChainId;
  signature: string;
  slot: number;
  commitment: CopyCommitment;
  leaderWallet: string;
  leaderSigned: boolean;
  success: boolean;
  observedAt: string;
  blockTime?: string;
  feeRaw?: string;
  accountKeys: string[];
  programIds: string[];
  assetDeltas: AssetDelta[];
  raw: TRaw;
}

export type IntentActionability = "observable" | "actionable";

export interface CopyIntent<TPayload = unknown> {
  id: string;
  adapterId: string;
  adapterVersion: number;
  chain: ChainId;
  leaderWallet: string;
  sourceTransactionId: string;
  sourceSignature: string;
  sourceIndex: number;
  kind: string;
  actionability: IntentActionability;
  confidence: number;
  createdAt: string;
  payload: TPayload;
}

export interface CopySubscription<TSettings = Record<string, unknown>> {
  id: string;
  chain: ChainId;
  leaderWallet: string;
  followerWallet: string;
  enabled: boolean;
  createdAt: string;
  settings: TSettings;
}

export interface CopyPlan<TPayload = unknown> {
  id: string;
  adapterId: string;
  adapterVersion: number;
  chain: ChainId;
  intentId: string;
  subscriptionId: string;
  followerWallet: string;
  action: string;
  createdAt: string;
  expiresAt?: string;
  payload: TPayload;
}

export type CopyJobStatus =
  | "DETECTED"
  | "VALIDATING"
  | "BLOCKED"
  | "PLANNING"
  | "READY"
  | "EXECUTING"
  | "DRY_RUN"
  | "SUBMITTED"
  | "CONFIRMED"
  | "SKIPPED"
  | "FAILED";

export interface CopyJobHistoryEntry {
  status: CopyJobStatus;
  at: string;
  reason?: string;
}

export interface ExecutionReceipt {
  status: "simulated" | "submitted" | "confirmed";
  transactionId?: string;
  submittedAt: string;
  metadata?: Record<string, unknown>;
}

export interface CopyJob {
  id: string;
  intentId: string;
  subscriptionId: string;
  followerWallet: string;
  chain: ChainId;
  status: CopyJobStatus;
  createdAt: string;
  updatedAt: string;
  reason?: string;
  attempts: number;
  plan?: CopyPlan;
  receipt?: ExecutionReceipt;
  history: CopyJobHistoryEntry[];
}

export interface GuardDecision {
  allowed: boolean;
  reason?: string;
}

export interface EngineHandleResult {
  transactionId: string;
  duplicate: boolean;
  accepted: boolean;
  reason?: string;
  intentIds: string[];
  jobIds: string[];
  errors: string[];
}
