/**
 * rhChain.ts
 * Watches PredictVault on Robinhood Chain for CollateralLocked events and
 * exposes helpers to call settleWin / settleLoss / cancelPosition.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  type Address,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config";
import { predictVaultAbi, erc20Abi } from "./abis";

const rhChain = {
  id: config.rhChainId,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rhChainRpc] } },
} as const;

export const rhPublicClient = createPublicClient({
  chain: rhChain,
  transport: http(config.rhChainRpc),
});

const operatorAccount = privateKeyToAccount(config.operatorPrivateKey);

export const rhWalletClient = createWalletClient({
  account: operatorAccount,
  chain: rhChain,
  transport: http(config.rhChainRpc),
});

export interface LockedPositionEvent {
  positionId: bigint;
  user: Address;
  token: Address;
  grossAmount: bigint;
  bookingFee: bigint;
  netAmount: bigint;
  marketId: `0x${string}`;
  outcomeIndex: number;
  blockNumber: bigint;
  txHash: `0x${string}`;
}

let lastScannedBlock = config.rhChainStartBlock;

/**
 * Scan for new CollateralLocked events since last check.
 * Returns new events and advances the cursor.
 */
export async function pollNewPositions(): Promise<LockedPositionEvent[]> {
  const latest = await rhPublicClient.getBlockNumber();
  if (latest <= lastScannedBlock) return [];

  const logs = await rhPublicClient.getLogs({
    address: config.predictVaultAddress,
    event: predictVaultAbi.find((x) => x.type === "event" && x.name === "CollateralLocked")!,
    fromBlock: lastScannedBlock + 1n,
    toBlock: latest,
  });

  lastScannedBlock = latest;

  return logs.map((log: any) => ({
    positionId: log.args.positionId as bigint,
    user: log.args.user as Address,
    token: log.args.token as Address,
    grossAmount: log.args.grossAmount as bigint,
    bookingFee: log.args.bookingFee as bigint,
    netAmount: log.args.netAmount as bigint,
    marketId: log.args.marketId as `0x${string}`,
    outcomeIndex: Number(log.args.outcomeIndex),
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
  }));
}

/**
 * Read a position from the vault.
 */
export async function getVaultPosition(positionId: bigint) {
  return rhPublicClient.readContract({
    address: config.predictVaultAddress,
    abi: predictVaultAbi,
    functionName: "getPosition",
    args: [positionId],
  });
}

/**
 * Approve this contract as spender of `token` on behalf of operator,
 * then call settleWin.
 */
export async function settleWin(positionId: bigint, grossPayout: bigint, token: Address) {
  // Approve PredictVault to pull grossPayout from operator
  const approveTx = await rhWalletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [config.predictVaultAddress, grossPayout],
  });
  await rhPublicClient.waitForTransactionReceipt({ hash: approveTx });

  const settleTx = await rhWalletClient.writeContract({
    address: config.predictVaultAddress,
    abi: predictVaultAbi,
    functionName: "settleWin",
    args: [positionId, grossPayout],
  });
  await rhPublicClient.waitForTransactionReceipt({ hash: settleTx });
  console.log(`[settle] WIN positionId=${positionId} tx=${settleTx}`);
}

/**
 * Mark a position as lost (collateral stays in vault).
 */
export async function settleLoss(positionId: bigint) {
  const tx = await rhWalletClient.writeContract({
    address: config.predictVaultAddress,
    abi: predictVaultAbi,
    functionName: "settleLoss",
    args: [positionId],
  });
  await rhPublicClient.waitForTransactionReceipt({ hash: tx });
  console.log(`[settle] LOSS positionId=${positionId} tx=${tx}`);
}

/**
 * Cancel a position and refund collateral to user.
 */
export async function cancelVaultPosition(positionId: bigint) {
  const tx = await rhWalletClient.writeContract({
    address: config.predictVaultAddress,
    abi: predictVaultAbi,
    functionName: "cancelPosition",
    args: [positionId],
  });
  await rhPublicClient.waitForTransactionReceipt({ hash: tx });
  console.log(`[cancel] positionId=${positionId} tx=${tx}`);
}

/**
 * Get token decimals.
 */
export async function getTokenDecimals(token: Address): Promise<number> {
  return Number(
    await rhPublicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })
  );
}
