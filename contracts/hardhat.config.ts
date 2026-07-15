import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

// Robinhood Chain — EVM L2, ETH gas token, ERC-4337 account abstraction support.
const RH_MAINNET_RPC_URL =
  process.env.RH_MAINNET_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const RH_TESTNET_RPC_URL =
  process.env.RH_TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      // OpenZeppelin Contracts 5.6+ uses MCOPY (introduced in Cancun); if
      // Robinhood Chain's EVM implementation is pinned to an older fork,
      // drop this to "paris"/"shanghai" and pin @openzeppelin/contracts <5.6.
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    robinhoodMainnet: {
      url: RH_MAINNET_RPC_URL,
      chainId: 4663,
      accounts,
    },
    robinhoodTestnet: {
      url: RH_TESTNET_RPC_URL,
      chainId: 46630,
      accounts,
    },
  },
  etherscan: {
    // Robinhood Chain block explorer verification, if/when a Blockscout or
    // Etherscan-compatible instance is available. Populate via .env once known.
    apiKey: {
      robinhoodMainnet: process.env.RH_EXPLORER_API_KEY ?? "",
      robinhoodTestnet: process.env.RH_EXPLORER_API_KEY ?? "",
    },
    customChains: [
      {
        network: "robinhoodMainnet",
        chainId: 4663,
        urls: {
          apiURL: process.env.RH_EXPLORER_API_URL ?? "",
          browserURL: process.env.RH_EXPLORER_BROWSER_URL ?? "",
        },
      },
      {
        network: "robinhoodTestnet",
        chainId: 46630,
        urls: {
          apiURL: process.env.RH_TESTNET_EXPLORER_API_URL ?? "",
          browserURL: process.env.RH_TESTNET_EXPLORER_BROWSER_URL ?? "",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
