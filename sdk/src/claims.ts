import type { Address, PublicClient, TransactionReceipt, WalletClient } from "viem";
import { rewardClaimerAbi } from "./abis/rewardClaimer";

export interface ClaimParams {
  index: bigint;
  amount: bigint;
  proof: `0x${string}`[];
}

export interface ClaimForParams extends ClaimParams {
  account: Address;
}

export interface ClaimsModuleConfig {
  walletClient: WalletClient;
  publicClient: PublicClient;
  rewardClaimerAddress: Address;
}

export interface ClaimsModule {
  isClaimed(index: bigint): Promise<boolean>;
  claim(params: ClaimParams): Promise<TransactionReceipt>;
  claimFor(params: ClaimForParams): Promise<TransactionReceipt>;
}

/**
 * Thin wrapper around RewardClaimer. `claim` is self-service (the connected
 * account receives the funds); `claimFor` is the agent-friendly path — any
 * relayer can submit it, but funds always go to `account`, never the caller.
 */
export function createClaimsModule({
  walletClient,
  publicClient,
  rewardClaimerAddress,
}: ClaimsModuleConfig): ClaimsModule {
  return {
    async isClaimed(index: bigint): Promise<boolean> {
      return publicClient.readContract({
        address: rewardClaimerAddress,
        abi: rewardClaimerAbi,
        functionName: "isClaimed",
        args: [index],
      });
    },

    async claim({ index, amount, proof }: ClaimParams) {
      const account = walletClient.account;
      if (!account) throw new Error("walletClient has no account attached");

      const hash = await walletClient.writeContract({
        chain: walletClient.chain,
        account,
        address: rewardClaimerAddress,
        abi: rewardClaimerAbi,
        functionName: "claim",
        args: [index, amount, proof],
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },

    /** Relay a claim on behalf of `account` — e.g. an agent paying gas for a user. */
    async claimFor({ index, account, amount, proof }: ClaimForParams) {
      const relayer = walletClient.account;
      if (!relayer) throw new Error("walletClient has no account attached");

      const hash = await walletClient.writeContract({
        chain: walletClient.chain,
        account: relayer,
        address: rewardClaimerAddress,
        abi: rewardClaimerAbi,
        functionName: "claimFor",
        args: [index, account, amount, proof],
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },
  };
}
