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
  46630: {
    // Robinhood Chain Testnet — deployed 2026-07-16. See contracts/deployments/robinhoodTestnet.json.
    forgeToken: "0x40113463a6f51937B811C9fc5B32584754CF6Abe",
    teamVesting: "0xF380564Ed541E1119E1D8aFE6CD0aC8d29932176",
    treasury: "0xe00F98dE07bEA9afb9Dcb457e3292E54E9E26C0B",
    distributionRouter: "0xC593e0Cd5c4fb653aB50Cf5521D5A060366e64ea",
    rewardClaimer: "0x88Eb6EC80CdbA56777a9d7c3c18F29193F17DFb8",
  },
};
