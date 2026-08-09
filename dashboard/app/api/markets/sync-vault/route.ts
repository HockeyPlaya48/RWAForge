import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// BankrollVault (Option A) was deployed, funded, and configured but never actually
// triggered outside manual scripts - this is what makes it run for real. Fire-and-
// forget from the frontend on every Predict tab load: scans every market/combo,
// and for any token whose pool is thinner than the vault's configured threshold,
// tops up the genuinely thin side by its bounded formula (see BankrollVault.sol).
// Fully idempotent and safe to call repeatedly - the vault's own checks
// (AlreadyAtTarget, PoolNotThin, CapsExhausted, etc.) make a no-op call cheap to
// attempt and safe to ignore.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RPC_URL = process.env.NEXT_PUBLIC_RH_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
const TSLA_ADDRESS = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E" as Address;
const TOKENS = [ETH_SENTINEL, TSLA_ADDRESS];

const PM_ABI = [
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

const COMBO_ABI = [
  {
    type: "function", name: "getCombo",
    inputs: [{ name: "comboId", type: "uint256" }],
    outputs: [
      { name: "legMarketIds", type: "uint256[]" }, { name: "legPicks", type: "bool[]" }, { name: "collateralToken", type: "address" },
      { name: "endTime", type: "uint256" }, { name: "yesPool", type: "uint256" }, { name: "noPool", type: "uint256" },
      { name: "outcome", type: "uint8" }, { name: "creator", type: "address" },
    ], stateMutability: "view",
  },
  { type: "function", name: "nextComboId", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

const VAULT_ABI = [
  { type: "function", name: "topUpMarket", inputs: [{ name: "marketId", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "topUpCombo", inputs: [{ name: "comboId", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "minDepthThreshold", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
] as const;

export async function GET() {
  const pmAddress = process.env.NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS as Address | undefined;
  const comboAddress = process.env.NEXT_PUBLIC_COMBO_MARKET_ADDRESS as Address | undefined;
  const vaultAddress = process.env.NEXT_PUBLIC_BANKROLL_VAULT_ADDRESS as Address | undefined;
  const rawKey = process.env.TREASURY_PRIVATE_KEY;
  if (!pmAddress || !comboAddress || !vaultAddress || !rawKey) {
    return NextResponse.json({ error: "PredictionMarket, ComboMarket, BankrollVault, or TREASURY_PRIVATE_KEY not configured" }, { status: 500 });
  }
  const pk = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;
  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, transport: http(RPC_URL) });

  const thresholds = new Map<string, bigint>();
  for (const token of TOKENS) {
    thresholds.set(token, await publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "minDepthThreshold", args: [token] }));
  }

  const toppedUpMarkets: number[] = [];
  const toppedUpCombos: number[] = [];
  const errors: string[] = [];

  const nextMarketId = await publicClient.readContract({ address: pmAddress, abi: PM_ABI, functionName: "nextMarketId" });
  for (let id = 0; id < Number(nextMarketId); id++) {
    const m = await publicClient.readContract({ address: pmAddress, abi: PM_ABI, functionName: "getMarket", args: [BigInt(id)] });
    if (Number(m.outcome) !== 0) continue;
    const threshold = thresholds.get(m.collateralToken.toLowerCase()) ?? thresholds.get(m.collateralToken);
    const total = m.yesPool + m.noPool;
    if (threshold === undefined || total >= threshold) continue;
    try {
      const hash = await walletClient.writeContract({ chain: null, address: vaultAddress, abi: VAULT_ABI, functionName: "topUpMarket", args: [BigInt(id)] });
      await publicClient.waitForTransactionReceipt({ hash });
      toppedUpMarkets.push(id);
    } catch (e) {
      // Expected no-ops (AlreadyAtTarget, CapsExhausted, NotConfigured, ...) - not real errors.
    }
  }

  const nextComboId = await publicClient.readContract({ address: comboAddress, abi: COMBO_ABI, functionName: "nextComboId" });
  for (let id = 0; id < Number(nextComboId); id++) {
    const [, , collateralToken, endTime, yesPool, noPool, outcome] = await publicClient.readContract({
      address: comboAddress, abi: COMBO_ABI, functionName: "getCombo", args: [BigInt(id)],
    });
    if (Number(outcome) !== 0) continue;
    if (Number(endTime) <= Math.floor(Date.now() / 1000)) continue; // betting already closed, vault can't help
    const threshold = thresholds.get(collateralToken.toLowerCase()) ?? thresholds.get(collateralToken);
    const total = yesPool + noPool;
    if (threshold === undefined || total >= threshold) continue;
    try {
      const hash = await walletClient.writeContract({ chain: null, address: vaultAddress, abi: VAULT_ABI, functionName: "topUpCombo", args: [BigInt(id)] });
      await publicClient.waitForTransactionReceipt({ hash });
      toppedUpCombos.push(id);
    } catch (e) {
      // Expected no-ops, same as above.
    }
  }

  return NextResponse.json({ ok: true, toppedUpMarkets, toppedUpCombos });
}
