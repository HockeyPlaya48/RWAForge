import { createPublicClient, http, type Address, type Chain, type PublicClient, type WalletClient } from "viem";
import { createDistributionModule, type DistributionModule } from "./distribution";
import { createClaimsModule, type ClaimsModule } from "./claims";
import { deployments, robinhoodChainMainnet, robinhoodChainTestnet } from "./config";

export { robinhoodChainMainnet, robinhoodChainTestnet, deployments } from "./config";
export type { RwaForgeDeployment } from "./config";
export { claimLeaf } from "./merkle";
export { erc20Abi, distributionRouterAbi, rewardClaimerAbi } from "./abis";
export type { DistributeParams } from "./distribution";
export type { ClaimParams, ClaimForParams } from "./claims";
export type { DistributionModule } from "./distribution";
export type { ClaimsModule } from "./claims";

export interface CreateRwaForgeClientParams {
  wallet: WalletClient;
  chain: Chain;
  /** Optional override; defaults to the address book in config.ts for this chain ID. */
  addresses?: {
    distributionRouter?: Address;
    rewardClaimer?: Address;
  };
  /** Optional override for reads; defaults to a public client on the same chain/transport. */
  rpcUrl?: string;
}

export interface RwaForgeClient {
  publicClient: PublicClient;
  walletClient: WalletClient;
  distribution?: DistributionModule;
  claims?: ClaimsModule;
}

/**
 * Creates a bundled RWAForge client: a wallet client's write access plus a
 * public client for reads, wired to the DistributionRouter and RewardClaimer
 * for the given chain. Pass `addresses` to override the built-in deployment
 * address book (useful for local/testnet development before addresses are
 * published).
 */
export function createRwaForgeClient({ wallet, chain, addresses, rpcUrl }: CreateRwaForgeClientParams): RwaForgeClient {
  const deployment = deployments[chain.id];
  const distributionRouterAddress = addresses?.distributionRouter ?? deployment?.distributionRouter;
  const rewardClaimerAddress = addresses?.rewardClaimer ?? deployment?.rewardClaimer;

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl ?? chain.rpcUrls.default.http[0]),
  });

  return {
    publicClient,
    walletClient: wallet,
    distribution: distributionRouterAddress
      ? createDistributionModule({
          walletClient: wallet,
          publicClient,
          distributionRouterAddress,
        })
      : undefined,
    claims: rewardClaimerAddress
      ? createClaimsModule({
          walletClient: wallet,
          publicClient,
          rewardClaimerAddress,
        })
      : undefined,
  };
}
