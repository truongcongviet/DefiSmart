import { getTraderLeaderboard } from "@/lib/traders/fomo-provider";
import { TRADER_WINDOWS, type TraderWindow } from "@/lib/traders/types";

export const runtime = "nodejs";

function isTraderWindow(value: string | null): value is TraderWindow {
  return TRADER_WINDOWS.some((window) => window === value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedWindow = url.searchParams.get("window");
  const window = isTraderWindow(requestedWindow) ? requestedWindow : "30d";
  const leaderboard = await getTraderLeaderboard(window);

  return Response.json(leaderboard, {
    headers: {
      "Cache-Control":
        "private, max-age=0, s-maxage=300, stale-while-revalidate=60",
    },
  });
}
