import { copyJobId } from "./ids";
import { KeyedSerialQueue } from "./keyed-serial-queue";
import type { CopyAdapter, CopyExecutor, CopyGuard, CopyStore } from "./ports";
import type {
  CopyIntent,
  CopyJob,
  CopySubscription,
  EngineHandleResult,
  ObservedTransaction,
} from "./types";

export interface CopyEngineOptions {
  store: CopyStore;
  adapters: CopyAdapter[];
  guards?: CopyGuard[];
  executor: CopyExecutor;
  now?: () => Date;
  queue?: KeyedSerialQueue;
}

export class CopyEngine {
  private readonly adapters = new Map<string, CopyAdapter>();
  private readonly store: CopyStore;
  private readonly guards: CopyGuard[];
  private readonly executor: CopyExecutor;
  private readonly now: () => Date;
  private readonly queue: KeyedSerialQueue;

  constructor(options: CopyEngineOptions) {
    this.store = options.store;
    this.guards = options.guards ?? [];
    this.executor = options.executor;
    this.now = options.now ?? (() => new Date());
    this.queue = options.queue ?? new KeyedSerialQueue();

    for (const adapter of options.adapters) {
      const existing = this.adapters.get(adapter.id);
      if (existing) {
        throw new Error(`Duplicate copy adapter id: ${adapter.id}`);
      }
      this.adapters.set(adapter.id, adapter);
    }
  }

  async handle(transaction: ObservedTransaction): Promise<EngineHandleResult> {
    const result: EngineHandleResult = {
      transactionId: transaction.id,
      duplicate: false,
      accepted: false,
      intentIds: [],
      jobIds: [],
      errors: [],
    };

    const inserted = await this.store.insertObservation(transaction);
    if (!inserted) {
      result.duplicate = true;
      result.reason = "DUPLICATE_OBSERVATION";
      return result;
    }

    if (!transaction.success) {
      result.reason = "SOURCE_TRANSACTION_FAILED";
      return result;
    }

    if (!transaction.leaderSigned) {
      result.reason = "LEADER_DID_NOT_SIGN";
      return result;
    }

    result.accepted = true;
    const intents = await this.decode(transaction, result.errors);
    const subscriptions = await this.store.listEnabledSubscriptions(
      transaction.chain,
      transaction.leaderWallet,
    );

    const work: Promise<void>[] = [];

    for (const intent of intents) {
      const intentInserted = await this.store.insertIntent(intent);
      if (!intentInserted) continue;
      result.intentIds.push(intent.id);

      for (const subscription of subscriptions) {
        const job = this.newJob(intent, subscription);
        const jobInserted = await this.store.insertJob(job);
        if (!jobInserted) continue;

        result.jobIds.push(job.id);
        const queueKey = `${subscription.chain}:${subscription.followerWallet}`;
        work.push(
          this.queue
            .run(queueKey, () =>
              this.processJob({ transaction, intent, subscription, job }),
            )
            .catch((error) => {
              result.errors.push(errorMessage(error));
            }),
        );
      }
    }

    await Promise.all(work);
    return result;
  }

  private async decode(transaction: ObservedTransaction, errors: string[]) {
    const intents: CopyIntent[] = [];

    for (const adapter of this.adapters.values()) {
      try {
        const decoded = await adapter.decode(transaction);
        for (const intent of decoded) {
          if (intent.adapterId !== adapter.id) {
            throw new Error(
              `Adapter ${adapter.id} returned intent for ${intent.adapterId}`,
            );
          }
          if (intent.adapterVersion !== adapter.version) {
            throw new Error(
              `Adapter ${adapter.id} returned unsupported version ${intent.adapterVersion}`,
            );
          }
          intents.push(intent);
        }
      } catch (error) {
        errors.push(`Adapter ${adapter.id}: ${errorMessage(error)}`);
      }
    }

    return intents;
  }

  private newJob(intent: CopyIntent, subscription: CopySubscription): CopyJob {
    const at = this.now().toISOString();
    return {
      id: copyJobId(intent, subscription),
      intentId: intent.id,
      subscriptionId: subscription.id,
      followerWallet: subscription.followerWallet,
      chain: subscription.chain,
      status: "DETECTED",
      createdAt: at,
      updatedAt: at,
      attempts: 0,
      history: [{ status: "DETECTED", at }],
    };
  }

  private async processJob(input: {
    transaction: ObservedTransaction;
    intent: CopyIntent;
    subscription: CopySubscription;
    job: CopyJob;
  }) {
    const { transaction, intent, subscription, job } = input;
    const adapter = this.adapters.get(intent.adapterId);
    if (!adapter) {
      await this.transition(job.id, "FAILED", "ADAPTER_NOT_FOUND");
      return;
    }

    try {
      await this.transition(job.id, "VALIDATING");

      if (intent.actionability !== "actionable") {
        await this.transition(job.id, "SKIPPED", "INTENT_NOT_ACTIONABLE");
        return;
      }

      for (const guard of this.guards) {
        const decision = await guard.evaluate({
          transaction,
          intent,
          subscription,
        });
        if (!decision.allowed) {
          await this.transition(
            job.id,
            "BLOCKED",
            decision.reason ?? `BLOCKED_BY_${guard.id}`,
          );
          return;
        }
      }

      await this.transition(job.id, "PLANNING");
      const plan = await adapter.plan(intent, subscription);
      if (!plan) {
        await this.transition(job.id, "SKIPPED", "ADAPTER_DECLINED_TO_PLAN");
        return;
      }

      await this.store.updateJob({
        jobId: job.id,
        status: "READY",
        at: this.now().toISOString(),
        plan,
      });
      await this.store.updateJob({
        jobId: job.id,
        status: "EXECUTING",
        at: this.now().toISOString(),
        incrementAttempts: true,
      });

      const receipt = await this.executor.execute({
        transaction,
        intent,
        subscription,
        plan,
      });

      const status =
        receipt.status === "simulated"
          ? "DRY_RUN"
          : receipt.status === "confirmed"
            ? "CONFIRMED"
            : "SUBMITTED";

      await this.store.updateJob({
        jobId: job.id,
        status,
        at: this.now().toISOString(),
        receipt,
      });
    } catch (error) {
      await this.transition(job.id, "FAILED", errorMessage(error));
    }
  }

  private async transition(
    jobId: string,
    status: CopyJob["status"],
    reason?: string,
  ) {
    await this.store.updateJob({
      jobId,
      status,
      at: this.now().toISOString(),
      reason,
    });
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
