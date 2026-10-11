import axios from "axios";

import { getServerEnv } from "@/lib/env";

const LP_AGENT_BASE_URL = "https://api.lpagent.io/open-api/v1";

function createLpAgentClient() {
  const env = getServerEnv();

  return axios.create({
    baseURL: LP_AGENT_BASE_URL,
    timeout: 20_000,
    headers: {
      "x-api-key": env.API_KEY_LPSMART,
    },
  });
}

const lpAgentClient = createLpAgentClient();

export async function fetchLpOpeningPositions(owner: string) {
  const response = await lpAgentClient.get("/lp-positions/opening", {
    params: { owner },
  });

  return response.data;
}

export async function fetchLpHistoricalPositions(
  owner: string,
  page = 1,
  limit = 100,
) {
  const response = await lpAgentClient.get("/lp-positions/historical", {
    params: { owner, page, limit },
  });

  return response.data;
}

export async function fetchLpOverview(owner: string) {
  const response = await lpAgentClient.get("/lp-positions/overview", {
    params: { owner },
  });

  return response.data;
}

export async function fetchLpRevenue(owner: string) {
  const response = await lpAgentClient.get(`/lp-positions/revenue/${owner}`);

  return response.data;
}

export async function fetchLpLogs(
  owner: string,
  chain = "SOL",
  position?: string,
) {
  const response = await lpAgentClient.get("/lp-positions/logs", {
    params: {
      owner,
      chain,
      ...(position ? { position } : {}),
    },
  });

  return response.data;
}

export async function fetchTokenBalances(owner: string) {
  const response = await lpAgentClient.get("/token/balance", {
    params: { owner },
  });

  return response.data;
}
