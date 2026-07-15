/**
 * Example: relay a Merkle claim on behalf of a user (agent-friendly path).
 *
 * The proof/index/amount would normally come from your offchain distribution
 * dataset (the same one used to build the Merkle tree published via
 * RewardClaimer.updateMerkleRoot) — see sdk/src/merkle.ts for the leaf format.
 *
 * Usage:
 *   cp .env.example .env
 *   # fill in DISTRIBUTOR_PRIVATE_KEY (used here as the relayer key), REWARD_CLAIMER_ADDRESS
 *   npm run example:claim
 */
import "dotenv/config";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRwaForgeClient, robinhoodChainTestnet } from "../src";

async function main() {
  const relayerKey = process.env.DISTRIBUTOR_PRIVATE_KEY as `0x${string}`;
  const rpcUrl = process.env.RH_RPC_URL ?? robinhoodChainTestnet.rpcUrls.default.http[0];
  const rewardClaimerAddress = process.env.REWARD_CLAIMER_ADDRESS as `0x${string}`;

  const relayer = privateKeyToAccount(relayerKey);
  const wallet = createWalletClient({
    account: relayer,
    chain: robinhoodChainTestnet,
    transport: http(rpcUrl),
  });

  const forge = createRwaForgeClient({
    wallet,
    chain: robinhoodChainTestnet,
    rpcUrl,
    addresses: { rewardClaimer: rewardClaimerAddress },
  });

  if (!forge.claims) throw new Error("RewardClaimer address not configured");

  // Example claim data — replace with a real entry from your distribution dataset.
  const claim = {
    index: 42n,
    account: "0x000000000000000000000000000000000000A1" as `0x${string}`,
    amount: 5_000000000000000000n, // 5 tokens at 18 decimals
    proof: [] as `0x${string}`[],
  };

  const alreadyClaimed = await forge.claims.isClaimed(claim.index);
  if (alreadyClaimed) {
    console.log(`Index ${claim.index} already claimed.`);
    return;
  }

  const receipt = await forge.claims.claimFor(claim);
  console.log("Claim relayed in tx:", receipt.transactionHash);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
