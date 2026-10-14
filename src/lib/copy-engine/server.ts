import { PgCopyStore } from "./pg-store";

/**
 * Web-app side access to the copy store (one pool per process). Copy
 * features need `DATABASE_URL` and `COPY_KEY_SECRET`; without them the API
 * routes answer 503 with a hint instead of failing deeper down.
 */

let store: Promise<PgCopyStore> | null = null;

export function copyConfigured() {
  return Boolean(
    process.env.DATABASE_URL?.trim() && process.env.COPY_KEY_SECRET?.trim(),
  );
}

export function getCopyStore(): Promise<PgCopyStore> {
  if (!store) {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("DATABASE_URL is not set");
    store = PgCopyStore.open(url);
  }
  return store;
}

export function copyKeySecret(): string {
  const secret = process.env.COPY_KEY_SECRET?.trim();
  if (!secret) throw new Error("COPY_KEY_SECRET is not set");
  return secret;
}
