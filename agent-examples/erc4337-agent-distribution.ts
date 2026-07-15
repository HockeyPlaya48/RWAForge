/**
 * Example: an autonomous agent distributing an RWA/stock token via its own
 * ERC-4337 smart account, with gas optionally sponsored by a paymaster.
 *
 * This is the core "agent-native" flow RWAForge is designed around: the
 * agent never needs an EOA with ETH for gas, never needs to hold a session
 * with DistributionRouter beyond a standard ERC-20 approval, and can batch
 * `approve` + `distribute` into a single UserOperation.
 *
 * Requires an ERC-4337 bundler endpoint for Robinhood Chain (and, for
 * sponsored gas, a paymaster endpoint implementing the standard
 * `pm_sponsorUserOperation` / `pm_getPaymasterData` RPC).
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x...            # controls the smart account (or a scoped session key)
 *   RH_RPC_URL=https://rpc.testnet.chain.robinhood.com
 *   BUNDLER_URL=https://your-bundler.example.com/rpc
 *   PAYMASTER_URL=https://your-paymaster.example.com/rpc   # optional
 *   DISTRIBUTION_ROUTER_ADDRESS=0x...
 *   STOCK_TOKEN_ADDRESS=0x...
 *   npx ts-node agent-examples/erc4337-agent-distribution.ts
 */
import "dotenv/config";
import { createPublicClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBundlerClient,
  createPaymasterClient,
  toSoladySmartAccount,
} from "viem/account-abstraction";
import { robinhoodChainTestnet } from "../sdk/src/config";
import { distributionRouterAbi } from "../sdk/src/abis/distributionRouter";
import { erc20Abi } from "../sdk/src/abis/erc20";

async function main() {
  const rpcUrl = process.env.RH_RPC_URL ?? robinhoodChainTestnet.rpcUrls.default.http[0];
  const bundlerUrl = process.env.BUNDLER_URL;
  const paymasterUrl = process.env.PAYMASTER_URL;
  const agentPrivateKey = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
  const distributionRouterAddress = process.env.DISTRIBUTION_ROUTER_ADDRESS as `0x${string}`;
  const stockTokenAddress = process.env.STOCK_TOKEN_ADDRESS as `0x${string}`;

  if (!bundlerUrl) throw new Error("BUNDLER_URL is required (ERC-4337 bundler for Robinhood Chain)");

  const publicClient = createPublicClient({
    chain: robinhoodChainTestnet,
    transport: http(rpcUrl),
  });

  // The key controlling the agent's smart account. In production this is
  // typically a scoped session key rather than the agent's root key, limited
  // to calling DistributionRouter/RewardClaimer via the smart account's
  // session-key module.
  const owner = privateKeyToAccount(agentPrivateKey);

  // Solady's ERC-4337 account implementation — audited, minimal, and widely
  // deployed across L2s. Swap for your preferred implementation (Coinbase
  // Smart Wallet, Kernel, Safe, a custom factory) if Robinhood Chain
  // standardizes on a different one.
  const smartAccount = await toSoladySmartAccount({
    client: publicClient,
    owner,
  });

  console.log("Agent smart account address:", smartAccount.address);

  const paymasterClient = paymasterUrl ? createPaymasterClient({ transport: http(paymasterUrl) }) : undefined;

  const bundlerClient = createBundlerClient({
    account: smartAccount,
    client: publicClient,
    paymaster: paymasterClient,
    transport: http(bundlerUrl),
  });

  // Example payout set — in practice this comes from whatever triggered the
  // agent's reward logic (a completed task, a referral event, a staking epoch).
  const recipients: `0x${string}`[] = [
    "0x000000000000000000000000000000000000A1",
    "0x000000000000000000000000000000000000A2",
  ];
  const amounts = [parseEther("10"), parseEther("25")];
  const total = amounts.reduce((a, b) => a + b, 0n);

  const feeBps = await publicClient.readContract({
    address: distributionRouterAddress,
    abi: distributionRouterAbi,
    functionName: "feeBps",
  });
  const fee = (total * feeBps) / 10_000n;

  // Batch approve + distribute into a single UserOperation so the whole
  // payout is atomic from the agent's perspective.
  const userOpHash = await bundlerClient.sendUserOperation({
    calls: [
      {
        to: stockTokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [distributionRouterAddress, total + fee],
      },
      {
        to: distributionRouterAddress,
        abi: distributionRouterAbi,
        functionName: "distribute",
        args: [stockTokenAddress, recipients, amounts],
      },
    ],
  });

  console.log("UserOperation submitted:", userOpHash);
  const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
  console.log("UserOperation confirmed, tx:", receipt.receipt.transactionHash);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
