import { z } from "zod";

/**
 * Server-side environment. Every variable is optional: the LP analysis reads
 * public Meteora data and needs no API key.
 */
const serverEnvSchema = z.object({
  LP_DATA_MAX_POOLS: z.coerce.number().int().positive().optional(),
});

export function getServerEnv() {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server env: ${reason}`);
  }

  return parsed.data;
}
