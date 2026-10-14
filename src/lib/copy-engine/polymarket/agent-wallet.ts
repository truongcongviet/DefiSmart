import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { privateKeyToAccount } from "viem/accounts";

/**
 * Server-side Polygon key for a user's copy agent. The key never leaves the
 * server: it is generated here, encrypted with `COPY_KEY_SECRET` (AES-256-GCM)
 * and stored in Postgres. The worker decrypts it to sign CLOB orders.
 */

export interface EncryptedKey {
  /** base64(iv):base64(tag):base64(ciphertext) */
  blob: string;
  address: `0x${string}`;
}

function keyFromSecret(secret: string) {
  if (secret.length < 16)
    throw new Error("COPY_KEY_SECRET must be at least 16 characters");
  return createHash("sha256").update(secret).digest();
}

export function encryptPrivateKey(
  privateKey: `0x${string}`,
  secret: string,
): string {
  const key = keyFromSecret(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString("base64")).join(":");
}

export function decryptPrivateKey(blob: string, secret: string): `0x${string}` {
  const [iv, tag, data] = blob
    .split(":")
    .map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]).toString("utf8");
  if (!/^0x[0-9a-fA-F]{64}$/.test(decrypted))
    throw new Error("Decrypted key is malformed");
  return decrypted as `0x${string}`;
}

export function generateAgentKey(secret: string): EncryptedKey {
  const privateKey = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  return {
    blob: encryptPrivateKey(privateKey, secret),
    address: account.address,
  };
}

export function agentAccount(blob: string, secret: string) {
  return privateKeyToAccount(decryptPrivateKey(blob, secret));
}
