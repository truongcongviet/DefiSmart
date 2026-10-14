import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createSessionToken,
  getServerSession,
  getSessionConfig,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  verifyPrivyAccessToken,
} from "@/lib/auth/server-session";

const createSessionSchema = z.object({
  accessToken: z.string().min(1),
  network: z.enum(["solana", "polygon"]).nullable().optional(),
});

/** Returns the current server session, if server sessions are configured. */
export async function GET() {
  if (!getSessionConfig()) {
    return NextResponse.json({ configured: false, session: null });
  }

  const session = await getServerSession();

  return NextResponse.json({ configured: true, session });
}

/**
 * Exchanges a Privy access token for a 7-day httpOnly session cookie.
 * The access token is verified locally against the Privy verification key.
 */
export async function POST(request: Request) {
  const config = getSessionConfig();

  if (!config) {
    return NextResponse.json(
      {
        configured: false,
        session: null,
        error: "server_session_not_configured",
      },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createSessionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let userId: string;

  try {
    ({ userId } = await verifyPrivyAccessToken(
      parsed.data.accessToken,
      config,
    ));
  } catch {
    return NextResponse.json(
      { error: "invalid_access_token" },
      { status: 401 },
    );
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const session = {
    userId,
    network: parsed.data.network ?? null,
    issuedAt,
    expiresAt: issuedAt + SESSION_TTL_SECONDS,
  };
  const token = await createSessionToken(session, config);

  const response = NextResponse.json({ configured: true, session });
  response.cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(session.expiresAt),
  );

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });

  return response;
}
