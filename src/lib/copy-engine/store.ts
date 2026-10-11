import type { CopyStore } from "./ports";
import type {
  CopyIntent,
  CopyJob,
  CopySubscription,
  ObservedTransaction,
} from "./types";

export interface CopyStoreSnapshot {
  version: 1;
  observations: Record<string, ObservedTransaction>;
  intents: Record<string, CopyIntent>;
  subscriptions: Record<string, CopySubscription>;
  jobs: Record<string, CopyJob>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function emptyCopyStoreSnapshot(): CopyStoreSnapshot {
  return {
    version: 1,
    observations: {},
    intents: {},
    subscriptions: {},
    jobs: {},
  };
}

export class MemoryCopyStore implements CopyStore {
  protected readonly state: CopyStoreSnapshot;

  constructor(initialState: CopyStoreSnapshot = emptyCopyStoreSnapshot()) {
    this.state = clone(initialState);
  }

  protected async afterMutation(): Promise<void> {}

  async insertObservation(transaction: ObservedTransaction) {
    if (this.state.observations[transaction.id]) return false;
    this.state.observations[transaction.id] = clone(transaction);
    await this.afterMutation();
    return true;
  }

  async insertIntent(intent: CopyIntent) {
    if (this.state.intents[intent.id]) return false;
    this.state.intents[intent.id] = clone(intent);
    await this.afterMutation();
    return true;
  }

  async upsertSubscription(subscription: CopySubscription) {
    this.state.subscriptions[subscription.id] = clone(subscription);
    await this.afterMutation();
  }

  async listEnabledSubscriptions(chain: string, leaderWallet: string) {
    return Object.values(this.state.subscriptions)
      .filter(
        (subscription) =>
          subscription.enabled &&
          subscription.chain === chain &&
          subscription.leaderWallet === leaderWallet,
      )
      .map(clone);
  }

  async insertJob(job: CopyJob) {
    if (this.state.jobs[job.id]) return false;
    this.state.jobs[job.id] = clone(job);
    await this.afterMutation();
    return true;
  }

  async updateJob(input: {
    jobId: string;
    status: CopyJob["status"];
    at: string;
    reason?: string;
    plan?: CopyJob["plan"];
    receipt?: CopyJob["receipt"];
    incrementAttempts?: boolean;
  }) {
    const job = this.state.jobs[input.jobId];
    if (!job) throw new Error(`Copy job not found: ${input.jobId}`);

    job.status = input.status;
    job.updatedAt = input.at;
    job.reason = input.reason;
    if (input.plan) job.plan = clone(input.plan);
    if (input.receipt) job.receipt = clone(input.receipt);
    if (input.incrementAttempts) job.attempts += 1;
    job.history.push({
      status: input.status,
      at: input.at,
      reason: input.reason,
    });

    await this.afterMutation();
    return clone(job);
  }

  async getJob(jobId: string) {
    const job = this.state.jobs[jobId];
    return job ? clone(job) : undefined;
  }

  snapshot() {
    return clone(this.state);
  }
}
