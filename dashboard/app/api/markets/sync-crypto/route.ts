import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Keeps a rolling "will BTC/ETH exceed $X in the next hour?" market open for each
// asset. No cron needed - this is idempotent, so it's called (fire-and-forget) from
// the frontend whenever the Predict tab loads: the first visitor after a window
// expires resolves it (against Coinbase's real historical candle for that exact
// hour, so late checks are still accurate) and opens the next one.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RPC_URL = process.env.NEXT_PUBLIC_RH_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const TSLA_ADDRESS = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E" as Address;
const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
const WINDOW_SECONDS = 3600; // 1 hour
const ASSETS = ["BTC", "ETH"] as const;
const MAX_RECENT_IDS_TO_SCAN = 40;
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
    type: "function", name: "createMarket",
    inputs: [{ name: "question", type: "string" }, { name: "collateralToken", type: "address" }, { name: "endTime", type: "uint256" }],
    outputs: [{ name: "marketId", type: "uint256" }], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "resolveMarket",
    inputs: [{ name: "marketId", type: "uint256" }, { name: "yesWon", type: "bool" }], outputs: [], stateMutability: "nonpayable",
  },
  { type: "function", name: "nextMarketId", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

function questionFor(asset: string, threshold: number): string {
  return `Will ${asset} exceed $${threshold.toFixed(2)} in the next hour?`;
}

const QUESTION_PATTERN = /^Will (BTC|ETH) exceed \$([\d,]+\.\d{2}) in the next hour\?$/;

async function currentPrice(asset: string): Promise<number> {
  const r = await fetch(`https://api.exchange.coinbase.com/products/${asset}-USD/ticker`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Coinbase ticker failed for ${asset}`);
  const data = await r.json();
  return parseFloat(data.price);
}

/** [timestamp, low, high, open, close, volume] for the 1h candle covering [endTime-3600, endTime]. */
async function closePriceAt(asset: string, endTimeSec: number): Promise<number | null> {
  const start = new Date((endTimeSec - WINDOW_SECONDS) * 1000).toISOString();
  const end = new Date(endTimeSec * 1000).toISOString();
  const r = await fetch(
    `https://api.exchange.coinbase.com/products/${asset}-USD/candles?start=${start}&end=${end}&granularity=${WINDOW_SECONDS}`,
    { cache: "no-store" }
  );
  if (!r.ok) return null;
  const candles: number[][] = await r.json();
  if (!candles.length) return null;
  return candles[0][4]; // close
}

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
  const resolved: { id: number; asset: string; yesWon: boolean }[] = [];
  const created: { id: string; question: string }[] = [];
  const openAssets = new Set<string>();

  for (let i = 0; i < recentIds.length; i++) {
    const id = recentIds[i];
    const m = markets[i];
    const match = QUESTION_PATTERN.exec(m.question);
    if (!match) continue;
    const [, asset] = match;

    if (Number(m.outcome) === 0 && Number(m.endTime) > now) {
      openAssets.add(asset); // still current, nothing to do
      continue;
    }
    if (Number(m.outcome) === 0 && Number(m.endTime) <= now) {
      const threshold = parseFloat(match[2].replace(/,/g, ""));
      const close = await closePriceAt(asset, Number(m.endTime));
      if (close === null) continue; // Coinbase doesn't have the candle yet, try again later
      const yesWon = close > threshold;
      const hash = await walletClient.writeContract({
        chain: null, address: pmAddress, abi: PM_ABI, functionName: "resolveMarket", args: [BigInt(id), yesWon],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      resolved.push({ id, asset, yesWon });
    }
  }

  for (const asset of ASSETS) {
    if (openAssets.has(asset)) continue; // already has a live window
    const price = await currentPrice(asset);
    const question = questionFor(asset, price);
    const endTime = BigInt(now + WINDOW_SECONDS);

    const ethHash = await walletClient.writeContract({
      chain: null, address: pmAddress, abi: PM_ABI, functionName: "createMarket", args: [question, ETH_SENTINEL, endTime],
    });
    await publicClient.waitForTransactionReceipt({ hash: ethHash });
    const ethId = (await publicClient.readContract({ address: pmAddress, abi: PM_ABI, functionName: "nextMarketId" })) - 1n;

    const tslaHash = await walletClient.writeContract({
      chain: null, address: pmAddress, abi: PM_ABI, functionName: "createMarket", args: [question, TSLA_ADDRESS, endTime],
    });
    await publicClient.waitForTransactionReceipt({ hash: tslaHash });
    const tslaId = (await publicClient.readContract({ address: pmAddress, abi: PM_ABI, functionName: "nextMarketId" })) - 1n;

    created.push({ id: `${ethId}/${tslaId}`, question });
  }

  return NextResponse.json({ ok: true, resolved, created });
}
