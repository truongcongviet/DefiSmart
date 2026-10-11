import type { CopyExecutor } from "./ports";

export class DryRunCopyExecutor implements CopyExecutor {
  async execute(input: Parameters<CopyExecutor["execute"]>[0]) {
    return {
      status: "simulated" as const,
      submittedAt: new Date().toISOString(),
      metadata: {
        adapterId: input.plan.adapterId,
        action: input.plan.action,
        followerWallet: input.subscription.followerWallet,
      },
    };
  }
}
