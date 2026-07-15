import { createConfig, http, injected } from "wagmi";
import { robinhoodChainMainnet, robinhoodChainTestnet } from "@rwaforge/sdk";

const rpcUrl = process.env.NEXT_PUBLIC_RH_RPC_URL ?? robinhoodChainTestnet.rpcUrls.default.http[0];

export const wagmiConfig = createConfig({
  chains: [robinhoodChainTestnet, robinhoodChainMainnet],
  connectors: [injected()],
  transports: {
    [robinhoodChainTestnet.id]: http(rpcUrl),
    [robinhoodChainMainnet.id]: http(),
  },
});

export const contractAddresses = {
  distributionRouter: process.env.NEXT_PUBLIC_DISTRIBUTION_ROUTER_ADDRESS as `0x${string}`,
  rewardClaimer: process.env.NEXT_PUBLIC_REWARD_CLAIMER_ADDRESS as `0x${string}`,
  forgeToken: process.env.NEXT_PUBLIC_FORGE_TOKEN_ADDRESS as `0x${string}`,
};
