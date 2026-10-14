import { NextResponse } from "next/server";

import { getServerSession, getSessionConfig } from "@/lib/auth/server-session";
import { copyConfigured } from "@/lib/copy-engine/server";

/** Shared gate for the copy API: configuration first, then a signed-in user. */
export async function requireCopyUser(): Promise<
  { userId: string } | { response: NextResponse }
> {
  if (!copyConfigured()) {
    return {
      response: NextResponse.json(
        {
          message:
            "Copy trading is not configured on this server. Set DATABASE_URL and COPY_KEY_SECRET.",
          configured: false,
        },
        { status: 503 },
      ),
    };
  }
  if (!getSessionConfig()) {
    return {
      response: NextResponse.json(
        {
          message:
            "Server sessions are not configured. Set PRIVY_VERIFICATION_KEY and SESSION_SECRET so the app can tell who you are.",
          configured: false,
        },
        { status: 503 },
      ),
    };
  }
  const session = await getServerSession();
  if (!session) {
    return {
      response: NextResponse.json(
        { message: "Sign in to manage copy trading.", configured: true },
        { status: 401 },
      ),
    };
  }
  return { userId: session.userId };
}
