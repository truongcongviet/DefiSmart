import axios from "axios";
import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env";

const SMART_LP_URL = "https://api.lpagent.io/api/v1/smart-lp";

const DEFAULT_QUERY = {
  page: "1",
  pageSize: "12",
  orderBy: "total_pnl_native:desc",
  lastActivity: "1D",
  firstActivity: "",
  minWinRateNative: "0.7",
  minAvgMonthlyPnlNative: "6",
  minTotalLp: "1000",
};

function formatBearerToken(token: string) {
  if (token.toLowerCase().startsWith("bearer ")) {
    return token;
  }

  return `Bearer ${token}`;
}

function looksLikeJwt(token: string) {
  return token.split(".").length === 3;
}

export async function GET(request: Request) {
  const env = getServerEnv();
  const url = new URL(request.url);

  const query: Record<string, string> = { ...DEFAULT_QUERY };
  const allowedKeys = [
    "page",
    "pageSize",
    "orderBy",
    "lastActivity",
    "firstActivity",
    "minWinRateNative",
    "minAvgMonthlyPnlNative",
    "minTotalLp",
    "minAvgAgeHour",
    "minExpectedValue",
    "minTotalPnlNative",
  ] as const;

  for (const key of allowedKeys) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      query[key] = value;
    }
  }

  try {
    const preferBearer =
      env.LPAGENT_BEARER_TOKEN ||
      (looksLikeJwt(env.API_KEY_LPSMART)
        ? env.API_KEY_LPSMART
        : undefined);

    const response = await axios.get(SMART_LP_URL, {
      params: query,
      timeout: 30_000,
      headers: {
        accept: "application/json, text/plain, */*",
        "x-api-key": env.API_KEY_LPSMART,
        ...(preferBearer
          ? { authorization: formatBearerToken(preferBearer) }
          : {}),
        chain: env.LPAGENT_CHAIN,
        ...(env.LPAGENT_TURNSTILE_TOKEN
          ? { "x-turnstile-token": env.LPAGENT_TURNSTILE_TOKEN }
          : {}),
      },
    });

    return NextResponse.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const isUnauthorized = error.response?.status === 401;
      return NextResponse.json(
        {
          message: isUnauthorized
            ? "Unauthorized: smart-lp cần Bearer token hợp lệ (LPAGENT_BEARER_TOKEN) và có thể cần LPAGENT_TURNSTILE_TOKEN."
            : error.response?.data?.message ||
              error.message ||
              "Failed to fetch smart LP wallets",
          status: error.response?.status,
          upstream: error.response?.data ?? null,
        },
        { status: error.response?.status || 500 },
      );
    }

    return NextResponse.json(
      { message: "Unexpected server error" },
      { status: 500 },
    );
  }
}
