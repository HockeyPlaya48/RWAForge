import type { Address, PublicClient, TransactionReceipt, WalletClient } from "viem";
import { distributionRouterAbi } from "./abis/distributionRouter";
import { erc20Abi } from "./abis/erc20";

export interface DistributeParams {
  /** Token being distributed (any ERC-20, including RH Chain stock tokens). */
  token: Address;
  /** Recipient addresses. */
  recipients: Address[];
  /** Amount each recipient receives, in the token's native decimals. */
  amounts: bigint[];
}

export interface DistributionModuleConfig {
  walletClient: WalletClient;
  publicClient: PublicClient;
  distributionRouterAddress: Address;
}

export interface DistributionModule {
  quoteRequiredApproval(amounts: bigint[]): Promise<bigint>;
  approve(token: Address, amounts: bigint[]): Promise<TransactionReceipt>;
  distribute(params: DistributeParams): Promise<TransactionReceipt>;
  approveAndDistribute(params: DistributeParams): Promise<TransactionReceipt>;
}

/**
 * Thin wrapper around DistributionRouter. Handles the approve-then-distribute
 * flow so callers don't have to reason about the router's fee-on-top model
 * (sum(amounts) + protocol fee must be approved before calling distribute).
 */
export function createDistributionModule({
  walletClient,
  publicClient,
  distributionRouterAddress,
}: DistributionModuleConfig): DistributionModule {
  return {
    /**
     * Reads the current fee (bps) and returns the total amount the caller
     * must have approved for the router to pull: sum(amounts) + fee.
     */
    async quoteRequiredApproval(amounts: bigint[]): Promise<bigint> {
      const feeBps = await publicClient.readContract({
        address: distributionRouterAddress,
        abi: distributionRouterAbi,
        functionName: "feeBps",
      });
      const total = amounts.reduce((sum, a) => sum + a, 0n);
      const fee = (total * feeBps) / 10_000n;
      return total + fee;
    },

    /** Approves the router for exactly the amount a distribution will need. */
    async approve(token: Address, amounts: bigint[]) {
      const required = await this.quoteRequiredApproval(amounts);
      const account = walletClient.account;
      if (!account) throw new Error("walletClient has no account attached");

      const hash = await walletClient.writeContract({
        chain: walletClient.chain,
        account,
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [distributionRouterAddress, required],
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },

    /** Calls DistributionRouter.distribute. Assumes approval has already been granted. */
    async distribute({ token, recipients, amounts }: DistributeParams) {
      if (recipients.length !== amounts.length) {
        throw new Error("recipients and amounts must be the same length");
      }
      const account = walletClient.account;
      if (!account) throw new Error("walletClient has no account attached");

      const hash = await walletClient.writeContract({
        chain: walletClient.chain,
        account,
        address: distributionRouterAddress,
        abi: distributionRouterAbi,
        functionName: "distribute",
        args: [token, recipients, amounts],
      });
      return publicClient.waitForTransactionReceipt({ hash });
    },

    /** Convenience: approves the exact required amount, then distributes. */
    async approveAndDistribute(params: DistributeParams) {
      await this.approve(params.token, params.amounts);
      return this.distribute(params);
    },
  };
}
