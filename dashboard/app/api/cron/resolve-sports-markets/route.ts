import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Companion to /api/cron/daily-sports-markets: creating a market doesn't resolve it.
// This finds dynamically-created sports markets whose betting window has closed but
// which are still Unresolved, looks up the real result from Polymarket (which the
// question text was derived from), and resolves them - so parlays referencing them
// can actually settle and positions become claimable.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RPC_URL = process.env.NEXT_PUBLIC_RH_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const GAMMA_API = "https://gamma-api.polymarket.com";
const MAX_RECENT_IDS_TO_SCAN = 60;

// Same curated ids the frontend treats as static - never touched by this job.
const STATIC_MARKET_IDS = new Set([0, 1, 2, 3, 4, 5, 6, 13, 14, 15, 16, 17]);

const PM_ABI = [
  {
    type: "function", name: "getMarket",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "question", type: "string" }, { name: "collateralToken", type: "address" }, { name: "endTime", type: "uint256" },
      { name: "yesPool", type: "uint256" }, { name: "noPool", type: "uint256" }, { name: "outcome", type: "uint8" }, { name: "creator", type: "address" },
    ]}], stateMutability: "view",
  },
  {
    type: "function", name: "resolveMarket",
    inputs: [{ name: "marketId", type: "uint256" }, { name: "yesWon", type: "bool" }], outputs: [], stateMutability: "nonpayable",
  },
  { type: "function", name: "nextMarketId", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

function parseOutcomes(field: unknown): string[] {
  if (Array.isArray(field)) return field as string[];
  if (typeof field === "string") {
    try { return JSON.parse(field); } catch { return []; }
  }
  return [];
}

const MLB_PATTERN = /^Will the (.+) beat the (.+) today\?$/;
const TENNIS_PATTERN = /^Will (.+) beat (.+) in their upcoming match\?$/;

function extractNames(question: string): [string, string] | null {
  const mlb = MLB_PATTERN.exec(question);
  if (mlb) return [mlb[1], mlb[2]];
  const tennis = TENNIS_PATTERN.exec(question);
  if (tennis) return [tennis[1], tennis[2]];
  return null;
}

async function fetchClosedPolymarketPages(pages = 4) {
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      fetch(`${GAMMA_API}/markets?closed=true&limit=100&offset=${i * 100}&order=volume&ascending=false`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    )
  );
  return results.flat() as any[];
}

/** Finds the real result on Polymarket for a game we created a market from, by matching the exact team/player names we embedded in our own question text. */
function findRealOutcome(closedMarkets: any[], nameA: string, nameB: string): boolean | null {
  for (const m of closedMarkets) {
    const outcomes = parseOutcomes(m.outcomes);
    if (outcomes.length !== 2) continue;
    if (outcomes[0] !== nameA || outcomes[1] !== nameB) continue;
    const prices = parseOutcomes(m.outcomePrices).map(Number);
    if (prices.length !== 2) continue;
    if (prices[0] === prices[1]) continue; // ambiguous/50-50, skip - try again next run
    return prices[0] > prices[1]; // true = nameA (our YES side) won
  }
  return null;
}

// Unlike daily-sports-markets (which creates new state and could be spammed to
// over-create), this route is truly idempotent - it only ever resolves a market
// that's genuinely past its window and still unresolved, and does nothing once
// resolved. Safe to leave open (no CRON_SECRET) so the frontend can trigger it
// directly on every page load instead of waiting for the once-daily cron.
export async function GET() {
  const pmAddress = process.env.NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS as Address | undefined;
  const rawKey = process.env.TREASURY_PRIVATE_KEY;
  if (!pmAddress || !rawKey) {
    return NextResponse.json({ error: "TREASURY_PRIVATE_KEY or NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS not configured" }, { status: 500 });
  }
  const pk = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;
  const account = privateKeyToAccount(pk);

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, transport: http(RPC_URL) });

  const nextId = await publicClient.readContract({ address: pmAddress, abi: PM_ABI, functionName: "nextMarketId" });
  const recentIds = Array.from({ length: Math.min(Number(nextId), MAX_RECENT_IDS_TO_SCAN) }, (_, i) => Number(nextId) - 1 - i)
    .filter((id) => id >= 0 && !STATIC_MARKET_IDS.has(id));

  const markets = await Promise.all(
    recentIds.map((id) => publicClient.readContract({ address: pmAddress, abi: PM_ABI, functionName: "getMarket", args: [BigInt(id)] }))
  );

  const now = Math.floor(Date.now() / 1000);
  const candidates = recentIds
    .map((id, i) => ({ id, market: markets[i] }))
    .filter(({ market }) => Number(market.outcome) === 0 && Number(market.endTime) <= now);

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, resolved: [], message: "nothing past its betting window and unresolved" });
  }

  const closedMarkets = await fetchClosedPolymarketPages(4);

  const resolved: { id: number; question: string; yesWon: boolean }[] = [];
  const stillUnknown: { id: number; question: string }[] = [];

  for (const { id, market } of candidates) {
    const names = extractNames(market.question);
    if (!names) { stillUnknown.push({ id, question: market.question }); continue; }
    const yesWon = findRealOutcome(closedMarkets, names[0], names[1]);
    if (yesWon === null) { stillUnknown.push({ id, question: market.question }); continue; }

    const hash = await walletClient.writeContract({
      chain: null, address: pmAddress, abi: PM_ABI, functionName: "resolveMarket", args: [BigInt(id), yesWon],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    resolved.push({ id, question: market.question, yesWon });
  }

  return NextResponse.json({ ok: true, resolved, stillUnknown });
}
