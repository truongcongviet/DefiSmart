import type { CopyStore } from "./ports";
import type {
  CopyIntent,
  CopyJob,
  CopyJobStatus,
  CopyPlan,
  CopySubscription,
  ExecutionReceipt,
  ObservedTransaction,
} from "./types";

/**
 * Postgres-backed copy store: observations, intents, subscriptions and jobs
 * survive worker restarts and are visible to the web app (the UI lists a
 * user's subscriptions and their jobs from here). Tables are created lazily.
 */

interface PgPoolLike {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
  end?: () => Promise<void>;
}

export interface SubscriptionRecord extends CopySubscription {
  /** Owner (Privy user id); null for subscriptions created from the CLI. */
  ownerUserId: string | null;
}

export class PgCopyStore implements CopyStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly pool: PgPoolLike) {}

  static async open(connectionString: string): Promise<PgCopyStore> {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString,
      max: 4,
      ssl: /sslmode=require|neon\.tech|supabase/.test(connectionString)
        ? { rejectUnauthorized: false }
        : undefined,
    }) as unknown as PgPoolLike;
    const store = new PgCopyStore(pool);
    await store.migrate();
    return store;
  }

  async migrate() {
    if (!this.ready) {
      this.ready = this.pool
        .query(
          `
          create table if not exists copy_observations (
            id text primary key,
            chain text not null,
            leader_wallet text not null,
            observed_at timestamptz not null,
            payload jsonb not null
          );
          create table if not exists copy_intents (
            id text primary key,
            chain text not null,
            leader_wallet text not null,
            kind text not null,
            created_at timestamptz not null,
            payload jsonb not null
          );
          create table if not exists copy_subscriptions (
            id text primary key,
            owner_user_id text,
            chain text not null,
            leader_wallet text not null,
            follower_wallet text not null,
            enabled boolean not null default true,
            created_at timestamptz not null,
            settings jsonb not null default '{}'::jsonb
          );
          create index if not exists copy_subscriptions_leader
            on copy_subscriptions (chain, leader_wallet) where enabled;
          create index if not exists copy_subscriptions_owner
            on copy_subscriptions (owner_user_id);
          create table if not exists copy_jobs (
            id text primary key,
            subscription_id text not null,
            intent_id text not null,
            status text not null,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            payload jsonb not null
          );
          create index if not exists copy_jobs_subscription
            on copy_jobs (subscription_id, created_at desc);
          create table if not exists copy_agents (
            user_id text primary key,
            chain text not null default 'polygon',
            address text not null unique,
            key_blob text not null,
            created_at timestamptz not null default now()
          );
        `,
        )
        .then(() => undefined);
    }
    await this.ready;
  }

  async insertObservation(transaction: ObservedTransaction) {
    await this.migrate();
    const result = await this.pool.query(
      `insert into copy_observations (id, chain, leader_wallet, observed_at, payload)
       values ($1, $2, $3, $4, $5::jsonb) on conflict (id) do nothing`,
      [
        transaction.id,
        transaction.chain,
        transaction.leaderWallet,
        transaction.observedAt,
        JSON.stringify(transaction),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async insertIntent(intent: CopyIntent) {
    await this.migrate();
    const result = await this.pool.query(
      `insert into copy_intents (id, chain, leader_wallet, kind, created_at, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb) on conflict (id) do nothing`,
      [
        intent.id,
        intent.chain,
        intent.leaderWallet,
        intent.kind,
        intent.createdAt,
        JSON.stringify(intent),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async upsertSubscription(
    subscription: CopySubscription,
    ownerUserId?: string | null,
  ) {
    await this.migrate();
    await this.pool.query(
      `insert into copy_subscriptions
         (id, owner_user_id, chain, leader_wallet, follower_wallet, enabled, created_at, settings)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       on conflict (id) do update set
         enabled = excluded.enabled,
         follower_wallet = excluded.follower_wallet,
         settings = excluded.settings,
         owner_user_id = coalesce(excluded.owner_user_id, copy_subscriptions.owner_user_id)`,
      [
        subscription.id,
        ownerUserId ?? null,
        subscription.chain,
        subscription.leaderWallet,
        subscription.followerWallet,
        subscription.enabled,
        subscription.createdAt,
        JSON.stringify(subscription.settings ?? {}),
      ],
    );
  }

  async deleteSubscription(id: string, ownerUserId?: string) {
    await this.migrate();
    const result = await this.pool.query(
      ownerUserId
        ? `delete from copy_subscriptions where id = $1 and owner_user_id = $2`
        : `delete from copy_subscriptions where id = $1`,
      ownerUserId ? [id, ownerUserId] : [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private rowToSubscription(row: Record<string, unknown>): SubscriptionRecord {
    return {
      id: String(row.id),
      ownerUserId: row.owner_user_id == null ? null : String(row.owner_user_id),
      chain: String(row.chain),
      leaderWallet: String(row.leader_wallet),
      followerWallet: String(row.follower_wallet),
      enabled: Boolean(row.enabled),
      createdAt: new Date(row.created_at as string).toISOString(),
      settings: (row.settings as Record<string, unknown>) ?? {},
    };
  }

  async listEnabledSubscriptions(chain: string, leaderWallet: string) {
    await this.migrate();
    const { rows } = await this.pool.query(
      `select * from copy_subscriptions where enabled and chain = $1 and leader_wallet = $2`,
      [chain, leaderWallet],
    );
    return rows.map((row) => this.rowToSubscription(row));
  }

  /** Every enabled subscription on a chain (the worker derives leaders from it). */
  async listEnabledByChain(chain: string) {
    await this.migrate();
    const { rows } = await this.pool.query(
      `select * from copy_subscriptions where enabled and chain = $1 order by created_at`,
      [chain],
    );
    return rows.map((row) => this.rowToSubscription(row));
  }

  async listSubscriptionsByOwner(ownerUserId: string) {
    await this.migrate();
    const { rows } = await this.pool.query(
      `select * from copy_subscriptions where owner_user_id = $1 order by created_at desc`,
      [ownerUserId],
    );
    return rows.map((row) => this.rowToSubscription(row));
  }

  async insertJob(job: CopyJob) {
    await this.migrate();
    const result = await this.pool.query(
      `insert into copy_jobs (id, subscription_id, intent_id, status, created_at, updated_at, payload)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb) on conflict (id) do nothing`,
      [
        job.id,
        job.subscriptionId,
        job.intentId,
        job.status,
        job.createdAt,
        job.updatedAt,
        JSON.stringify(job),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateJob(input: {
    jobId: string;
    status: CopyJobStatus;
    at: string;
    reason?: string;
    plan?: CopyPlan;
    receipt?: ExecutionReceipt;
    incrementAttempts?: boolean;
  }) {
    await this.migrate();
    const current = await this.getJob(input.jobId);
    if (!current) throw new Error(`Copy job not found: ${input.jobId}`);
    const job: CopyJob = {
      ...current,
      status: input.status,
      updatedAt: input.at,
      reason: input.reason,
      plan: input.plan ?? current.plan,
      receipt: input.receipt ?? current.receipt,
      attempts: current.attempts + (input.incrementAttempts ? 1 : 0),
      history: [
        ...current.history,
        { status: input.status, at: input.at, reason: input.reason },
      ],
    };
    await this.pool.query(
      `update copy_jobs set status = $2, updated_at = $3, payload = $4::jsonb where id = $1`,
      [job.id, job.status, job.updatedAt, JSON.stringify(job)],
    );
    return job;
  }

  async getJob(jobId: string) {
    await this.migrate();
    const { rows } = await this.pool.query<{ payload: CopyJob }>(
      `select payload from copy_jobs where id = $1`,
      [jobId],
    );
    return rows[0]?.payload;
  }

  async listJobsBySubscription(subscriptionId: string, limit = 50) {
    await this.migrate();
    const { rows } = await this.pool.query<{ payload: CopyJob }>(
      `select payload from copy_jobs where subscription_id = $1
       order by created_at desc limit $2`,
      [subscriptionId, limit],
    );
    return rows.map((row) => row.payload);
  }

  /** USD committed by executed/running jobs of a subscription since `sinceIso`. */
  async sumCommittedUsd(subscriptionId: string, sinceIso: string) {
    await this.migrate();
    const { rows } = await this.pool.query<{ total: string }>(
      `select coalesce(sum((payload->'plan'->'payload'->>'amountUsd')::numeric), 0) as total
       from copy_jobs
       where subscription_id = $1 and created_at >= $2
         and status in ('READY', 'EXECUTING', 'DRY_RUN', 'SUBMITTED', 'CONFIRMED')`,
      [subscriptionId, sinceIso],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async getAgent(userId: string) {
    await this.migrate();
    const { rows } = await this.pool.query<{
      address: string;
      key_blob: string;
      created_at: string;
    }>(
      `select address, key_blob, created_at from copy_agents where user_id = $1`,
      [userId],
    );
    const row = rows[0];
    return row
      ? {
          address: row.address,
          keyBlob: row.key_blob,
          createdAt: new Date(row.created_at).toISOString(),
        }
      : null;
  }

  async getAgentByAddress(address: string) {
    await this.migrate();
    const { rows } = await this.pool.query<{
      user_id: string;
      address: string;
      key_blob: string;
    }>(
      `select user_id, address, key_blob from copy_agents where lower(address) = lower($1)`,
      [address],
    );
    const row = rows[0];
    return row
      ? { userId: row.user_id, address: row.address, keyBlob: row.key_blob }
      : null;
  }

  async createAgent(userId: string, address: string, keyBlob: string) {
    await this.migrate();
    await this.pool.query(
      `insert into copy_agents (user_id, address, key_blob) values ($1, $2, $3)
       on conflict (user_id) do nothing`,
      [userId, address, keyBlob],
    );
    return this.getAgent(userId);
  }

  async close() {
    await this.pool.end?.();
  }
}
