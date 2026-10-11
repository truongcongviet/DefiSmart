import axios from "axios";

const dlmmClient = axios.create({
  baseURL: "https://dlmm.datapi.meteora.ag",
  timeout: 20_000,
});

const dammV2Client = axios.create({
  baseURL: "https://damm-v2.datapi.meteora.ag",
  timeout: 20_000,
});

export async function fetchDlmmOpenPortfolio(wallet: string) {
  const response = await dlmmClient.get("/portfolio/open", {
    params: {
      user: wallet,
      page: 1,
      page_size: 100,
    },
  });

  return response.data;
}

export async function fetchDammV2OpenPositions(wallet: string) {
  const response = await dammV2Client.get(`/wallets/${wallet}/open_positions`);

  return response.data;
}

export async function fetchDammV2ClosedPositions(wallet: string) {
  const response = await dammV2Client.get(
    `/wallets/${wallet}/closed_positions`,
    {
      params: {
        limit: 200,
      },
    },
  );

  return response.data;
}
