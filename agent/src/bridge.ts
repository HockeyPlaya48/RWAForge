/**
 * bridge.ts
 * LayerZero V2 OFT bridging for USDC between Polygon and Robinhood Chain.
 *
 * Flow A (Polygon → RH Chain): agent has USDC winnings on Polygon after
 *   Polymarket settlement; bridge them to RH Chain so they can be swapped
 *   to stock tokens and delivered to the user.
 *
 * Flow B (RH Chain → Polygon): not currently needed — agent pre-funds its
 *   own Polygon USDC float rather than bridging per position. If volume
 *   grows beyond the float, add a rebalance call here.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodePacked,
  pad,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config";
import { oftAbi, erc20Abi } from "./abis";

const polygonChain = {
  id: config.polygonChainId,
  name: "Polygon",
  nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
  rpcUrls: { default: { http: [config.polygonRpc] } },
} as const;

const polygonPublicClient = createPublicClient({
  chain: polygonChain,
  transport: http(config.polygonRpc),
});

const polygonWalletClient = createWalletClient({
  account: privateKeyToAccount(config.operatorPolygonPrivateKey),
  chain: polygonChain,
  transport: http(config.polygonRpc),
});

const operatorAddress = privateKeyToAccount(config.operatorPolygonPrivateKey).address;

/**
 * Bridge USDC from Polygon → Robinhood Chain via LayerZero V2 OFT.
 * Recipient is the operator's RH Chain address (same key, different chain).
 * Returns the LZ message GUID for tracking.
 */
export async function bridgeUsdcToRhChain(
  amountUsdc: bigint, // in USDC native decimals (6)
  recipientOnRhChain: Address
): Promise<`0x${string}`> {
  // Slippage tolerance: accept up to 0.5% less
  const minAmount = (amountUsdc * 995n) / 1000n;

  // Encode recipient as bytes32 (LZ format)
  const recipientBytes32 = pad(recipientOnRhChain, { size: 32 });

  const sendParam = {
    dstEid: config.lzEidRhChain,
    to: recipientBytes32 as `0x${string}`,
    amountLD: amountUsdc,
    minAmountLD: minAmount,
    extraOptions: "0x" as `0x${string}`,
    composeMsg: "0x" as `0x${string}`,
    oftCmd: "0x" as `0x${string}`,
  };

  // Quote the LZ native fee
  const fee = await polygonPublicClient.readContract({
    address: config.usdcOftPolygon,
    abi: oftAbi,
    functionName: "quoteSend",
    args: [sendParam, false],
  });

  console.log(
    `[bridge] Bridging ${amountUsdc} USDC Polygon→RHChain. LZ fee: ${fee.nativeFee} MATIC`
  );

  // Approve OFT to spend USDC
  const approveTx = await polygonWalletClient.writeContract({
    address: config.usdcPolygon,
    abi: erc20Abi,
    functionName: "approve",
    args: [config.usdcOftPolygon, amountUsdc],
  });
  await polygonPublicClient.waitForTransactionReceipt({ hash: approveTx });

  // Send via OFT
  const sendTx = await polygonWalletClient.writeContract({
    address: config.usdcOftPolygon,
    abi: oftAbi,
    functionName: "send",
    args: [sendParam, { nativeFee: fee.nativeFee, lzTokenFee: 0n }, operatorAddress],
    value: fee.nativeFee,
  });

  const receipt = await polygonPublicClient.waitForTransactionReceipt({ hash: sendTx });
  console.log(`[bridge] Sent. Tx: ${sendTx}`);

  // The GUID is emitted in the OFTSent event — parse it for tracking
  // (simplified: just return the tx hash as reference)
  return sendTx;
}

/**
 * Wait for bridged USDC to arrive on RH Chain.
 * Polls the operator's RH Chain USDC balance until it increases by ~amountUsdc.
 */
export async function waitForBridgeArrival(
  rhChainPublicClient: any,
  operatorRhAddress: Address,
  expectedAmount: bigint,
  timeoutMs = 5 * 60 * 1000
): Promise<void> {
  const start = Date.now();
  const usdcOftRh = config.usdcOftRhChain;

  const initialBalance: bigint = await rhChainPublicClient.readContract({
    address: usdcOftRh,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [operatorRhAddress],
  });

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10_000));
    const balance: bigint = await rhChainPublicClient.readContract({
      address: usdcOftRh,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [operatorRhAddress],
    });
    if (balance >= initialBalance + (expectedAmount * 99n) / 100n) {
      console.log(`[bridge] Funds arrived on RH Chain. Balance: ${balance}`);
      return;
    }
    console.log(`[bridge] Waiting for arrival... balance: ${balance}`);
  }
  throw new Error("[bridge] Timeout waiting for bridge arrival");
}
