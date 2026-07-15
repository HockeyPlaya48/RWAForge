import { defineChain, type Chain } from "viem";

/**
 * Robinhood Chain — EVM L2, ETH gas token, ERC-4337 account abstraction support.
 * RPC URLs default to the public endpoints; override with an Alchemy (or other
 * provider) URL via the `transport` you pass to viem's client, not here.
 */
export const robinhoodChainMainnet: Chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  testnet: false,
});

export const robinhoodChainTestnet: Chain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  testnet: true,
});

/** Known deployed addresses per chain ID. Fill in after running the deploy script. */
export interface RwaForgeDeployment {
  forgeToken: `0x${string}`;
  teamVesting: `0x${string}`;
  treasury: `0x${string}`;
  distributionRouter: `0x${string}`;
  rewardClaimer: `0x${string}`;
}

export const deployments: Partial<Record<number, RwaForgeDeployment>> = {
  // 4663: { forgeToken: "0x...", teamVesting: "0x...", treasury: "0x...", distributionRouter: "0x...", rewardClaimer: "0x..." },
  // 46630: { forgeToken: "0x...", teamVesting: "0x...", treasury: "0x...", distributionRouter: "0x...", rewardClaimer: "0x..." },
};
