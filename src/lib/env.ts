import { z } from "zod";

const serverEnvSchema = z.object({
  API_KEY_LPSMART: z.string().min(1, "Missing API_KEY_LPSMART in .env"),
  LPAGENT_BEARER_TOKEN: z.string().optional(),
  LPAGENT_TURNSTILE_TOKEN: z.string().optional(),
  LPAGENT_CHAIN: z.string().default("SOL"),
});

export function getServerEnv() {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const reason = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid server env: ${reason}`);
  }

  return parsed.data;
}
