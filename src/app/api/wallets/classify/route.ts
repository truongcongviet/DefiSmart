import { NextResponse } from "next/server";
import { z } from "zod";

import {
  classifyWallet,
  isValidWalletAddress,
} from "@/lib/analysis/classifier";

const requestSchema = z.object({
  wallets: z.array(z.string().min(1)).min(1).max(30),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          message: "Invalid payload. Expected { wallets: string[] }",
          issues: parsed.error.issues,
        },
        { status: 400 },
      );
    }

    const normalizedWallets = Array.from(
      new Set(
        parsed.data.wallets.map((wallet) => wallet.trim()).filter(Boolean),
      ),
    );

    const invalidWallets = normalizedWallets.filter(
      (wallet) => !isValidWalletAddress(wallet),
    );
    if (invalidWallets.length > 0) {
      return NextResponse.json(
        {
          message: "Some wallet addresses are invalid Solana addresses.",
          invalidWallets,
        },
        { status: 400 },
      );
    }

    const results = await Promise.allSettled(
      normalizedWallets.map((wallet) => classifyWallet(wallet)),
    );

    const successful = results
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof classifyWallet>>
        > => result.status === "fulfilled",
      )
      .map((result) => result.value)
      .sort((a, b) => b.smartScore - a.smartScore);

    const failed = results
      .map((result, index) => ({ result, wallet: normalizedWallets[index] }))
      .filter(
        (
          entry,
        ): entry is {
          result: PromiseRejectedResult;
          wallet: string;
        } => entry.result.status === "rejected",
      )
      .map((entry) => ({
        wallet: entry.wallet,
        error:
          entry.result.reason instanceof Error
            ? entry.result.reason.message
            : "Unknown error",
      }));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      totalWallets: normalizedWallets.length,
      successCount: successful.length,
      failureCount: failed.length,
      results: successful,
      errors: failed,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error";

    return NextResponse.json(
      {
        message,
      },
      { status: 500 },
    );
  }
}
