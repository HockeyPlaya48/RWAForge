/**
 * RWAForge PredictVault Operator Agent
 *
 * Main loop:
 *  1. Poll RH Chain for new CollateralLocked events.
 *  2. For each new position: price the collateral, put up equivalent USDC
 *     on Polygon, place Polymarket CLOB order.
 *  3. Every cycle: check all active positions against Polymarket resolution.
 *  4. On resolution:
 *     WIN  → redeem USDC winnings → bridge to RH Chain → swap to stock token
 *            → call vault.settleWin
 *     LOSS → call vault.settleLoss
 */

import "dotenv/config";
import { ethers } from "ethers";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config";
import { pollNewPositions, settleWin, settleLoss, cancelVaultPosition, getTokenDecimals, rhPublicClient } from "./rhChain";
import { bridgeUsdcToRhChain, waitForBridgeArrival } from "./bridge";
import { getPolygonUsdcBalance, estimateUsdcValue } from "./polygonSwap";
import {
  getClobWallet,
  createOrGetApiKey,
  getMarket,
  placeOrder,
  checkResolution,
  redeemWinnings,
  getPositions,
} from "./polymarketClob";

// ── In-memory state ───────────────────────────────────────────────────────────
interface TrackedPosition {
  positionId: bigint;
  user: `0x${string}`;
  token: `0x${string}`;
  netAmount: bigint;
  marketId: `0x${string}`;
  outcomeIndex: number;
  // Set after Polymarket order is placed
  conditionId?: string;
  clobTokenId?: string;
  polyOrderId?: string;
  usdcCommitted?: bigint; // USDC put up on Polygon for this position
}

const activePositions = new Map<string, TrackedPosition>();

// ── Init ──────────────────────────────────────────────────────────────────────
let clobWallet: ethers.Wallet;
let clobApiKey: string;
let clobApiSecret: string;
let clobPassphrase: string;
const operatorRhAddress = privateKeyToAccount(config.operatorPrivateKey).address;

async function init() {
  clobWallet = getClobWallet();
  console.log(`[agent] Operator address (Polygon): ${clobWallet.address}`);
  console.log(`[agent] Operator address (RH Chain): ${operatorRhAddress}`);

  try {
    const keys = await createOrGetApiKey(clobWallet);
    clobApiKey = keys.apiKey;
    clobApiSecret = keys.secret;
    clobPassphrase = keys.passphrase;
    console.log(`[agent] Polymarket CLOB API key ready`);
  } catch (err) {
    console.error(`[agent] Failed to get CLOB API key:`, err);
    throw err;
  }
}

// ── New position handler ──────────────────────────────────────────────────────
async function handleNewPosition(pos: Awaited<ReturnType<typeof pollNewPositions>>[number]) {
  const key = pos.positionId.toString();
  if (activePositions.has(key)) return;

  console.log(`[agent] New position #${pos.positionId} user=${pos.user} token=${pos.token}`);

  // Convert marketId (bytes32) to hex conditionId
  const conditionId = pos.marketId as string;

  // Fetch market from Polymarket CLOB
  const market = await getMarket(conditionId);
  if (!market || !market.acceptingOrders) {
    console.warn(`[agent] Market ${conditionId} not found or not accepting orders — cancelling position`);
    await cancelVaultPosition(pos.positionId);
    return;
  }

  const outcomeToken = market.tokens[pos.outcomeIndex];
  if (!outcomeToken) {
    console.warn(`[agent] Invalid outcome index ${pos.outcomeIndex} for market ${conditionId}`);
    await cancelVaultPosition(pos.positionId);
    return;
  }

  // Estimate USDC value of the locked collateral
  const decimals = await getTokenDecimals(pos.token);
  const usdcValue = await estimateUsdcValue(
    "unknown", // TODO: pass token symbol from off-chain metadata
    pos.netAmount,
    decimals
  );

  // Check we have enough USDC on Polygon
  const polygonBalance = await getPolygonUsdcBalance();
  if (polygonBalance < usdcValue) {
    console.error(
      `[agent] Insufficient USDC on Polygon. Need: ${usdcValue}, have: ${polygonBalance}. ` +
      `Please top up the operator wallet.`
    );
    // Don't cancel — retry next cycle when funded
    return;
  }

  // Place Polymarket order
  const price = outcomeToken.price;
  const usdcToSpend = Number(usdcValue) / 1e6;
  console.log(`[agent] Placing ${pos.outcomeIndex === 0 ? "YES" : "NO"} order for $${usdcToSpend.toFixed(2)} at ${price}`);

  const order = await placeOrder(clobWallet, clobApiKey, clobApiSecret, clobPassphrase, {
    tokenId: outcomeToken.token_id,
    side: "BUY",
    price,
    sizeUsdc: usdcToSpend,
  });

  console.log(`[agent] Order placed: ${order.orderId} status=${order.status}`);

  activePositions.set(key, {
    positionId: pos.positionId,
    user: pos.user,
    token: pos.token,
    netAmount: pos.netAmount,
    marketId: pos.marketId,
    outcomeIndex: pos.outcomeIndex,
    conditionId,
    clobTokenId: outcomeToken.token_id,
    polyOrderId: order.orderId,
    usdcCommitted: usdcValue,
  });
}

// ── Resolution handler ────────────────────────────────────────────────────────
async function checkAndSettlePositions() {
  for (const [key, pos] of activePositions.entries()) {
    if (!pos.conditionId) continue;

    const resolution = await checkResolution(pos.conditionId);
    if (!resolution.resolved) continue;

    console.log(`[agent] Market ${pos.conditionId} resolved. Winner index: ${resolution.winnerIndex}`);

    const userWon = resolution.winnerIndex === pos.outcomeIndex;

    if (userWon) {
      await handleWin(pos);
    } else {
      await handleLoss(pos);
    }

    activePositions.delete(key);
  }
}

async function handleWin(pos: TrackedPosition) {
  console.log(`[agent] Position #${pos.positionId} WON. Processing payout...`);

  // Redeem USDC from Polymarket (they auto-redeem winning shares)
  const usdcWinnings = await redeemWinnings(
    clobWallet, clobApiKey, clobApiSecret, clobPassphrase, pos.conditionId!
  );
  const usdcWinningsBn = BigInt(Math.round(usdcWinnings * 1e6));
  console.log(`[agent] Redeemed $${usdcWinnings.toFixed(2)} USDC from Polymarket`);

  // Bridge USDC from Polygon → RH Chain
  const bridgeTx = await bridgeUsdcToRhChain(usdcWinningsBn, operatorRhAddress);
  console.log(`[agent] Bridge tx: ${bridgeTx}`);

  // Wait for bridge arrival on RH Chain
  await waitForBridgeArrival(rhPublicClient, operatorRhAddress, usdcWinningsBn);

  // On RH Chain: swap bridged USDC → original stock token
  // This uses whatever DEX exists on RH Chain (Uniswap V3 fork assumed).
  // For now: operator must manually hold a float of the stock token, OR
  // a DEX swap is performed here using the same Uniswap ABI on RH Chain.
  // TODO: wire in RH Chain DEX once addresses are known.
  //
  // grossPayout = netAmount (collateral) + profit in stock token terms
  // Simplified: use netAmount as grossPayout (no conversion premium yet)
  const grossPayout = pos.netAmount;
  console.log(`[agent] Settling win. grossPayout=${grossPayout} token=${pos.token}`);

  await settleWin(pos.positionId, grossPayout, pos.token);
}

async function handleLoss(pos: TrackedPosition) {
  console.log(`[agent] Position #${pos.positionId} LOST.`);
  await settleLoss(pos.positionId);
  // USDC committed on Polygon stays in operator wallet (covers the loss float)
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function loop() {
  // 1. Check for new positions on RH Chain
  const newPositions = await pollNewPositions();
  for (const pos of newPositions) {
    await handleNewPosition(pos).catch((err) =>
      console.error(`[agent] Error handling position #${pos.positionId}:`, err)
    );
  }

  // 2. Check resolution on active positions
  await checkAndSettlePositions().catch((err) =>
    console.error(`[agent] Error checking settlements:`, err)
  );
}

async function main() {
  console.log(`[agent] RWAForge PredictVault Operator Agent starting...`);
  await init();

  console.log(`[agent] Starting main loop (interval: ${config.pollIntervalMs}ms)`);
  loop(); // run immediately
  setInterval(loop, config.pollIntervalMs);
}

main().catch((err) => {
  console.error("[agent] Fatal error:", err);
  process.exit(1);
});
