import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Runs daily (see vercel.json) to create fresh, real, live prediction markets from
// today's actual MLB games and ATP/WTA tennis matches on Polymarket - see
// docs/DAILY_SPORTS_MARKETS.md for the full design. Never statically cache this route.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RPC_URL = process.env.NEXT_PUBLIC_RH_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const GAMMA_API = "https://gamma-api.polymarket.com";
const TSLA_ADDRESS = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E" as Address;
const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
const MIN_TREASURY_ETH = 500_000_000_000_000n; // 0.0005 ETH safety floor - abort rather than drain to zero
const MAX_MLB_GAMES = 2;
const MAX_TENNIS_MATCHES = 2;
const BETTING_WINDOW_HOURS = 16; // how long a market stays open for bets before its game

const PM_ABI = [
  {
    type: "function", name: "createMarket",
    inputs: [{ name: "question", type: "string" }, { name: "collateralToken", type: "address" }, { name: "endTime", type: "uint256" }],
    outputs: [{ name: "marketId", type: "uint256" }], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "getMarket",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "question", type: "string" }, { name: "collateralToken", type: "address" }, { name: "endTime", type: "uint256" },
      { name: "yesPool", type: "uint256" }, { name: "noPool", type: "uint256" }, { name: "outcome", type: "uint8" }, { name: "creator", type: "address" },
    ]}], stateMutability: "view",
  },
  { type: "function", name: "nextMarketId", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

type Pick = { question: string; endTime: bigint };

function parseOutcomes(field: unknown): string[] {
  if (Array.isArray(field)) return field as string[];
  if (typeof field === "string") {
    try { return JSON.parse(field); } catch { return []; }
  }
  return [];
}

async function fetchPolymarketPages(pages = 4) {
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      fetch(`${GAMMA_API}/markets?active=true&closed=false&limit=100&offset=${i * 100}&order=volume24hr&ascending=false`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    )
  );
  return results.flat() as any[];
}

function slugDate(slug: string): string | null {
  const m = /(\d{4}-\d{2}-\d{2})$/.exec(slug ?? "");
  return m ? m[1] : null;
}

function eligibleDates(): Set<string> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  return new Set([today, tomorrow]);
}

function pickMlbGames(markets: any[], existingQuestions: Set<string>, max: number): Pick[] {
  const dates = eligibleDates();
  const picks: Pick[] = [];
  const seen = new Set<string>();
  for (const m of markets) {
    const date = slugDate(m.slug ?? "");
    if (!date || !dates.has(date) || !/^mlb-/.test(m.slug ?? "")) continue;
    const outcomes = parseOutcomes(m.outcomes);
    if (outcomes.length !== 2) continue;
    const question = `Will the ${outcomes[0]} beat the ${outcomes[1]} today?`;
    if (seen.has(question) || existingQuestions.has(question)) continue;
    seen.add(question);
    picks.push({ question, endTime: BigInt(Math.floor(Date.now() / 1000) + BETTING_WINDOW_HOURS * 3600) });
    if (picks.length >= max) break;
  }
  return picks;
}

function pickTennisMatches(markets: any[], existingQuestions: Set<string>, max: number): Pick[] {
  const dates = eligibleDates();
  const picks: Pick[] = [];
  const seen = new Set<string>();
  for (const m of markets) {
    const date = slugDate(m.slug ?? "");
    if (!date || !dates.has(date) || !/^(atp|wta)-/.test(m.slug ?? "")) continue;
    const outcomes = parseOutcomes(m.outcomes);
    if (outcomes.length !== 2) continue;
    const question = `Will ${outcomes[0]} beat ${outcomes[1]} in their upcoming match?`;
    if (seen.has(question) || existingQuestions.has(question)) continue;
    seen.add(question);
    picks.push({ question, endTime: BigInt(Math.floor(Date.now() / 1000) + BETTING_WINDOW_HOURS * 3600) });
    if (picks.length >= max) break;
  }
  return picks;
}

export async function GET(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const pmAddress = process.env.NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS as Address | undefined;
  const rawKey = process.env.TREASURY_PRIVATE_KEY;
  if (!pmAddress || !rawKey) {
    return NextResponse.json({ error: "TREASURY_PRIVATE_KEY or NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS not configured" }, { status: 500 });
  }
  const pk = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;
  const account = privateKeyToAccount(pk);

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, transport: http(RPC_URL) });

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance < MIN_TREASURY_ETH) {
    return NextResponse.json({ error: "treasury balance below safety floor, aborting", balance: balance.toString() }, { status: 500 });
  }

  // Avoid duplicate creation if this runs twice in a day: scan recent markets for identical questions.
  const nextId = await publicClient.readContract({ address: pmAddress, abi: PM_ABI, functionName: "nextMarketId" });
  const recentIds = Array.from({ length: Math.min(Number(nextId), 40) }, (_, i) => Number(nextId) - 1 - i).filter((id) => id >= 0);
  const recentMarkets = await Promise.all(
    recentIds.map((id) => publicClient.readContract({ address: pmAddress, abi: PM_ABI, functionName: "getMarket", args: [BigInt(id)] }))
  );
  const existingQuestions = new Set(recentMarkets.map((m) => m.question));

  const raw = await fetchPolymarketPages(4);
  const picks = [...pickMlbGames(raw, existingQuestions, MAX_MLB_GAMES), ...pickTennisMatches(raw, existingQuestions, MAX_TENNIS_MATCHES)];

  const created: { question: string; ethMarketId: string; tslaMarketId: string }[] = [];
  for (const pick of picks) {
    const ethHash = await walletClient.writeContract({
      chain: null, address: pmAddress, abi: PM_ABI, functionName: "createMarket", args: [pick.question, ETH_SENTINEL, pick.endTime],
    });
    await publicClient.waitForTransactionReceipt({ hash: ethHash });
    const ethMarketId = (await publicClient.readContract({ address: pmAddress, abi: PM_ABI, functionName: "nextMarketId" })) - 1n;

    const tslaHash = await walletClient.writeContract({
      chain: null, address: pmAddress, abi: PM_ABI, functionName: "createMarket", args: [pick.question, TSLA_ADDRESS, pick.endTime],
    });
    await publicClient.waitForTransactionReceipt({ hash: tslaHash });
    const tslaMarketId = (await publicClient.readContract({ address: pmAddress, abi: PM_ABI, functionName: "nextMarketId" })) - 1n;

    created.push({ question: pick.question, ethMarketId: ethMarketId.toString(), tslaMarketId: tslaMarketId.toString() });
  }

  return NextResponse.json({ ok: true, created, skipped: existingQuestions.size, treasuryBalance: balance.toString() });
}
