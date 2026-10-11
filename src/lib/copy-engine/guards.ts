import type { CopyGuard } from "./ports";

export class IntentAllowListGuard implements CopyGuard {
  readonly id = "intent-allow-list";

  constructor(
    private readonly allow: {
      adapterIds?: ReadonlySet<string>;
      kinds?: ReadonlySet<string>;
    },
  ) {}

  async evaluate(input: Parameters<CopyGuard["evaluate"]>[0]) {
    if (
      this.allow.adapterIds &&
      !this.allow.adapterIds.has(input.intent.adapterId)
    ) {
      return {
        allowed: false,
        reason: `ADAPTER_NOT_ALLOWED:${input.intent.adapterId}`,
      };
    }

    if (this.allow.kinds && !this.allow.kinds.has(input.intent.kind)) {
      return {
        allowed: false,
        reason: `INTENT_NOT_ALLOWED:${input.intent.kind}`,
      };
    }

    return { allowed: true };
  }
}

export class IntentConfidenceGuard implements CopyGuard {
  readonly id = "intent-confidence";

  constructor(private readonly minimumConfidence: number) {
    if (minimumConfidence < 0 || minimumConfidence > 1) {
      throw new Error("minimumConfidence must be between 0 and 1");
    }
  }

  async evaluate(input: Parameters<CopyGuard["evaluate"]>[0]) {
    return input.intent.confidence >= this.minimumConfidence
      ? { allowed: true }
      : {
          allowed: false,
          reason: `LOW_CONFIDENCE:${input.intent.confidence}`,
        };
  }
}

export class IntentAgeGuard implements CopyGuard {
  readonly id = "intent-age";

  constructor(
    private readonly maxAgeMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async evaluate(input: Parameters<CopyGuard["evaluate"]>[0]) {
    const observedAt = Date.parse(input.transaction.observedAt);
    const age = this.now() - observedAt;
    return age <= this.maxAgeMs
      ? { allowed: true }
      : { allowed: false, reason: `STALE_INTENT:${age}ms` };
  }
}
