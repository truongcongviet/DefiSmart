import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Where precomputed snapshots (leaderboards, swap caches) live.
 *
 * - With `DATABASE_URL` (Postgres, e.g. Neon/Supabase free tier): a
 *   `snapshots` table keyed by kind, with history. Works on Vercel.
 * - Otherwise: `data/<kind>.json` plus `data/history/<kind>/` on disk. Fine
 *   for local runs and for shipping a precomputed file with the deployment;
 *   writes silently no-op on a read-only filesystem.
 */

export interface StoredSnapshot<T> {
  generatedAt: string;
  payload: T;
}

export interface SnapshotMeta {
  generatedAt: string;
  bytes: number;
}

export interface SnapshotStore {
  readonly backend: "postgres" | "file";
  load<T>(kind: string): Promise<StoredSnapshot<T> | null>;
  save<T>(kind: string, payload: T, generatedAt?: string): Promise<void>;
  history(kind: string, limit?: number): Promise<SnapshotMeta[]>;
}

const HISTORY_KEEP = 20;
const DATA_DIR = path.join(process.cwd(), "data");

function safeKind(kind: string) {
  if (!/^[a-z0-9-]+$/i.test(kind))
    throw new Error(`Invalid snapshot kind: ${kind}`);
  return kind;
}

// ---------------------------------------------------------------------------
// File backend
// ---------------------------------------------------------------------------

const fileStore: SnapshotStore = {
  backend: "file",
  async load<T>(kind: string) {
    try {
      const raw = await fs.readFile(
        path.join(DATA_DIR, `${safeKind(kind)}.json`),
        "utf8",
      );
      const parsed = JSON.parse(raw) as Partial<StoredSnapshot<T>> & {
        generatedAt?: string;
      };
      if (!parsed || typeof parsed !== "object") return null;
      // Legacy files stored the payload at the top level.
      if ("payload" in parsed && parsed.payload !== undefined) {
        return {
          generatedAt: String(parsed.generatedAt ?? ""),
          payload: parsed.payload as T,
        };
      }
      return {
        generatedAt: String(parsed.generatedAt ?? ""),
        payload: parsed as unknown as T,
      };
    } catch {
      return null;
    }
  },
  async save<T>(
    kind: string,
    payload: T,
    generatedAt = new Date().toISOString(),
  ) {
    const name = safeKind(kind);
    const body = JSON.stringify({ generatedAt, payload });
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(path.join(DATA_DIR, `${name}.json`), body);
      const dir = path.join(DATA_DIR, "history", name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${generatedAt.replace(/[:.]/g, "-")}.json`),
        body,
      );
      const entries = (await fs.readdir(dir))
        .filter((f) => f.endsWith(".json"))
        .sort();
      for (const stale of entries.slice(
        0,
        Math.max(0, entries.length - HISTORY_KEEP),
      )) {
        await fs.rm(path.join(dir, stale), { force: true });
      }
    } catch {
      // read-only filesystem (Vercel): memory caches still apply
    }
  },
  async history(kind: string, limit = 10) {
    const dir = path.join(DATA_DIR, "history", safeKind(kind));
    try {
      const entries = (await fs.readdir(dir))
        .filter((f) => f.endsWith(".json"))
        .sort()
        .reverse();
      const out: SnapshotMeta[] = [];
      for (const file of entries.slice(0, limit)) {
        const stat = await fs.stat(path.join(dir, file));
        out.push({
          generatedAt: file
            .replace(/\.json$/, "")
            .replace(
              /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
              "$1-$2-$3T$4:$5:$6.$7Z",
            ),
          bytes: stat.size,
        });
      }
      return out;
    } catch {
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// Postgres backend (lazy import so the driver is optional at runtime)
// ---------------------------------------------------------------------------

interface PgPoolLike {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

let pgPool: PgPoolLike | null = null;
let pgReady: Promise<void> | null = null;

async function getPg(): Promise<PgPoolLike> {
  if (!pgPool) {
    const { Pool } = await import("pg");
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      ssl: /sslmode=require|neon\.tech|supabase/.test(
        process.env.DATABASE_URL ?? "",
      )
        ? { rejectUnauthorized: false }
        : undefined,
    }) as unknown as PgPoolLike;
  }
  if (!pgReady) {
    pgReady = pgPool
      .query(
        `create table if not exists snapshots (
           id bigserial primary key,
           kind text not null,
           generated_at timestamptz not null,
           payload jsonb not null
         );
         create index if not exists snapshots_kind_time on snapshots (kind, generated_at desc);`,
      )
      .then(() => undefined);
  }
  await pgReady;
  return pgPool;
}

const pgStore: SnapshotStore = {
  backend: "postgres",
  async load<T>(kind: string) {
    const pg = await getPg();
    const { rows } = await pg.query<{ generated_at: string; payload: T }>(
      `select generated_at, payload from snapshots where kind = $1
       order by generated_at desc limit 1`,
      [safeKind(kind)],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      generatedAt: new Date(row.generated_at).toISOString(),
      payload: row.payload,
    };
  },
  async save<T>(
    kind: string,
    payload: T,
    generatedAt = new Date().toISOString(),
  ) {
    const pg = await getPg();
    const name = safeKind(kind);
    await pg.query(
      `insert into snapshots (kind, generated_at, payload) values ($1, $2, $3::jsonb)`,
      [name, generatedAt, JSON.stringify(payload)],
    );
    await pg.query(
      `delete from snapshots where kind = $1 and id not in (
         select id from snapshots where kind = $1 order by generated_at desc limit $2)`,
      [name, HISTORY_KEEP],
    );
  },
  async history(kind: string, limit = 10) {
    const pg = await getPg();
    const { rows } = await pg.query<{ generated_at: string; bytes: string }>(
      `select generated_at, octet_length(payload::text) as bytes from snapshots
       where kind = $1 order by generated_at desc limit $2`,
      [safeKind(kind), limit],
    );
    return rows.map((row) => ({
      generatedAt: new Date(row.generated_at).toISOString(),
      bytes: Number(row.bytes),
    }));
  },
};

export function getSnapshotStore(): SnapshotStore {
  return process.env.DATABASE_URL?.trim() ? pgStore : fileStore;
}
