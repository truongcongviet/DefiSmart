import { importSPKI, jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";

import type { AccountNetwork } from "@/lib/chains";

export const SESSION_COOKIE = "lps_session";
/** Sessions stay valid for seven days, mirroring the LP Agent behaviour. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface ServerSession {
  userId: string;
  network: AccountNetwork | null;
  issuedAt: number;
  expiresAt: number;
}

interface SessionConfig {
  appId: string;
  verificationKey: string;
  secret: Uint8Array;
}

/**
 * Server sessions are optional. They are only issued when the Privy
 * verification key and a session secret are configured.
 */
export function getSessionConfig(): SessionConfig | null {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const verificationKey = process.env.PRIVY_VERIFICATION_KEY?.replace(
    /\\n/g,
    "\n",
  ).trim();
  const secret = process.env.SESSION_SECRET?.trim();

  if (!appId || !verificationKey || !secret || secret.length < 32) {
    return null;
  }

  return {
    appId,
    verificationKey,
    secret: new TextEncoder().encode(secret),
  };
}

export async function verifyPrivyAccessToken(
  accessToken: string,
  config: SessionConfig,
): Promise<{ userId: string }> {
  const publicKey = await importSPKI(config.verificationKey, "ES256");
  const { payload } = await jwtVerify(accessToken, publicKey, {
    issuer: "privy.io",
    audience: config.appId,
  });

  if (!payload.sub) {
    throw new Error("Privy access token has no subject");
  }

  return { userId: payload.sub };
}

export async function createSessionToken(
  session: ServerSession,
  config: SessionConfig,
): Promise<string> {
  return new SignJWT({ network: session.network })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt(session.issuedAt)
    .setExpirationTime(session.expiresAt)
    .sign(config.secret);
}

export async function readSessionToken(
  token: string,
  config: SessionConfig,
): Promise<ServerSession | null> {
  try {
    const { payload } = await jwtVerify(token, config.secret, {
      algorithms: ["HS256"],
    });

    if (!payload.sub || !payload.iat || !payload.exp) {
      return null;
    }

    const network = payload.network;

    return {
      userId: payload.sub,
      network: network === "solana" || network === "robinhood" ? network : null,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

/** Read the current server session from the request cookies. */
export async function getServerSession(): Promise<ServerSession | null> {
  const config = getSessionConfig();

  if (!config) {
    return null;
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  return readSessionToken(token, config);
}

export function sessionCookieOptions(expiresAt: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt * 1000),
  };
}
