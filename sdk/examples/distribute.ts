/**
 * Example: distribute a stock/RWA token to a batch of recipients.
 *
 * Usage:
 *   cp .env.example .env
 *   # fill in DISTRIBUTOR_PRIVATE_KEY, DISTRIBUTION_ROUTER_ADDRESS, RH_RPC_URL
 *   npm run example:distribute
 */
import "dotenv/config";
import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRwaForgeClient, robinhoodChainTestnet } from "../src";

async function main() {
  const privateKey = process.env.DISTRIBUTOR_PRIVATE_KEY as `0x${string}`;
  const rpcUrl = process.env.RH_RPC_URL ?? robinhoodChainTestnet.rpcUrls.default.http[0];
  const distributionRouterAddress = process.env.DISTRIBUTION_ROUTER_ADDRESS as `0x${string}`;
  const stockTokenAddress = process.env.STOCK_TOKEN_ADDRESS as `0x${string}`;

  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({
    account,
    chain: robinhoodChainTestnet,
    transport: http(rpcUrl),
  });

  const forge = createRwaForgeClient({
    wallet,
    chain: robinhoodChainTestnet,
    rpcUrl,
    addresses: { distributionRouter: distributionRouterAddress },
  });

  if (!forge.distribution) throw new Error("DistributionRouter address not configured");

  const recipients: `0x${string}`[] = [
    "0x000000000000000000000000000000000000A1",
    "0x000000000000000000000000000000000000A2",
  ];
  const amounts = [parseEther("10"), parseEther("25")];

  console.log("Distributing to", recipients.length, "recipients...");
  const receipt = await forge.distribution.approveAndDistribute({
    token: stockTokenAddress,
    recipients,
    amounts,
  });
  console.log("Distribution confirmed in tx:", receipt.transactionHash);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
