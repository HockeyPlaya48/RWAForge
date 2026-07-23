/**
 * polygonSwap.ts
 * Uniswap V3 swap helper on Polygon.
 *
 * Primary use: swap USDC → bridged stock token equivalent after Polymarket
 * winnings are received. Since Robinhood tokenized stocks don't exist natively
 * on Polygon, winnings stay as USDC and are bridged back to RH Chain, where
 * a second swap (USDC → stock token) happens on whatever DEX RH Chain runs.
 *
 * This module handles the Polygon side:
 *  - Approve Uniswap router to spend USDC
 *  - Execute exactInputSingle swap (USDC → intermediary if needed)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config";
import { erc20Abi, uniswapRouterAbi } from "./abis";

const polygonChain = {
  id: config.polygonChainId,
  name: "Polygon",
  nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
  rpcUrls: { default: { http: [config.polygonRpc] } },
} as const;

export const polygonPublicClient = createPublicClient({
  chain: polygonChain,
  transport: http(config.polygonRpc),
});

export const polygonWalletClient = createWalletClient({
  account: privateKeyToAccount(config.operatorPolygonPrivateKey),
  chain: polygonChain,
  transport: http(config.polygonRpc),
});

const operatorAddress = privateKeyToAccount(config.operatorPolygonPrivateKey).address;

/**
 * Get the operator's USDC balance on Polygon.
 */
export async function getPolygonUsdcBalance(): Promise<bigint> {
  return polygonPublicClient.readContract({
    address: config.usdcPolygon,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [operatorAddress],
  });
}

/**
 * Swap USDC → tokenOut on Polygon via Uniswap V3.
 * Used when the target token exists on Polygon.
 * If tokenOut doesn't exist on Polygon, skip this and bridge USDC directly.
 *
 * @param tokenOut  Target token address on Polygon.
 * @param amountIn  USDC amount in (6 decimals).
 * @param minOut    Minimum tokenOut to receive (slippage protection).
 * @param feeTier   Uniswap pool fee tier (500=0.05%, 3000=0.3%, 10000=1%).
 */
export async function swapUsdcToToken(
  tokenOut: Address,
  amountIn: bigint,
  minOut: bigint,
  feeTier: 500 | 3000 | 10000 = 3000
): Promise<bigint> {
  // Approve router
  const approveTx = await polygonWalletClient.writeContract({
    address: config.usdcPolygon,
    abi: erc20Abi,
    functionName: "approve",
    args: [config.uniswapRouterPolygon, amountIn],
  });
  await polygonPublicClient.waitForTransactionReceipt({ hash: approveTx });

  const swapTx = await polygonWalletClient.writeContract({
    address: config.uniswapRouterPolygon,
    abi: uniswapRouterAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: config.usdcPolygon,
        tokenOut,
        fee: feeTier,
        recipient: operatorAddress,
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const receipt = await polygonPublicClient.waitForTransactionReceipt({ hash: swapTx });
  console.log(`[swap] USDC→${tokenOut} tx=${swapTx}`);

  // Return approximate amountOut (exact value is in the swap event; simplified here)
  return minOut;
}

/**
 * Estimate current USDC value of collateral token.
 * Uses a simple price lookup — in production, replace with Chainlink or
 * a Uniswap V3 quoter call for the RH Chain stock token.
 *
 * @param tokenSymbol  e.g. "AAPL", "TSLA"
 * @param amount       amount in token native decimals
 * @param decimals     token decimals
 * @returns            estimated USDC value (6 decimals)
 */
export async function estimateUsdcValue(
  tokenSymbol: string,
  amount: bigint,
  decimals: number
): Promise<bigint> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${tokenSymbol.toLowerCase()}&vs_currencies=usd`
    );
    const data = await res.json() as any;
    const priceUsd: number = data[tokenSymbol.toLowerCase()]?.usd ?? 0;
    const normalizedAmount = Number(amount) / 10 ** decimals;
    const usdValue = normalizedAmount * priceUsd;
    return BigInt(Math.round(usdValue * 1e6)); // USDC 6 decimals
  } catch {
    // Fallback: assume 1:1 (for testing)
    return amount / BigInt(10 ** (decimals - 6));
  }
}
