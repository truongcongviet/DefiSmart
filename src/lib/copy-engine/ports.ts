import type {
  CopyIntent,
  CopyJob,
  CopyJobStatus,
  CopyPlan,
  CopySubscription,
  ExecutionReceipt,
  GuardDecision,
  ObservedTransaction,
} from "./types";

export interface CopyAdapter {
  readonly id: string;
  readonly version: number;
  decode(transaction: ObservedTransaction): Promise<CopyIntent[]>;
  plan(
    intent: CopyIntent,
    subscription: CopySubscription,
  ): Promise<CopyPlan | null>;
}

export interface CopyGuard {
  readonly id: string;
  evaluate(input: {
    transaction: ObservedTransaction;
    intent: CopyIntent;
    subscription: CopySubscription;
  }): Promise<GuardDecision>;
}

export interface CopyExecutor {
  execute(input: {
    transaction: ObservedTransaction;
    intent: CopyIntent;
    subscription: CopySubscription;
    plan: CopyPlan;
  }): Promise<ExecutionReceipt>;
}

export interface CopyStore {
  insertObservation(transaction: ObservedTransaction): Promise<boolean>;
  insertIntent(intent: CopyIntent): Promise<boolean>;
  upsertSubscription(subscription: CopySubscription): Promise<void>;
  listEnabledSubscriptions(
    chain: string,
    leaderWallet: string,
  ): Promise<CopySubscription[]>;
  insertJob(job: CopyJob): Promise<boolean>;
  updateJob(input: {
    jobId: string;
    status: CopyJobStatus;
    at: string;
    reason?: string;
    plan?: CopyPlan;
    receipt?: ExecutionReceipt;
    incrementAttempts?: boolean;
  }): Promise<CopyJob>;
  getJob(jobId: string): Promise<CopyJob | undefined>;
}
