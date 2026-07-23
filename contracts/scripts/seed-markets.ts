import { ethers } from "hardhat";

/**
 * Seeds the 6 initial markets on the deployed PredictionMarket contract.
 * Market IDs will be 0-5 in creation order, matching the frontend DEMO_MARKETS.
 *
 * Usage:
 *   npx hardhat run scripts/seed-markets.ts --network robinhoodTestnet
 */

const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// Placeholder ERC-20 address for USGD on RH Chain testnet.
// Replace with real address once known — for now uses ETH_SENTINEL so all markets accept ETH.
const USGD_ADDRESS = ETH_SENTINEL; // TODO: swap for real USGD token address

const PM_ADDRESS = process.env.NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS
  ?? "0x3E157Af4d13921e2b2347Dd813705C5E78eC9E76";

const ABI = [
  {
    type: "function",
    name: "createMarket",
    inputs: [
      { name: "question", type: "string" },
      { name: "collateralToken", type: "address" },
      { name: "endTime", type: "uint256" },
    ],
    outputs: [{ name: "marketId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "nextMarketId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

function ts(dateStr: string): bigint {
  return BigInt(Math.floor(new Date(dateStr).getTime() / 1000));
}

const MARKETS = [
  {
    question: "Will tokenized AAPL on RH Chain exceed $220 by end of Q3 2026?",
    collateral: ETH_SENTINEL,
    endTime: ts("2026-09-30"),
  },
  {
    question: "Will the Federal Reserve cut rates in September 2026?",
    collateral: ETH_SENTINEL,
    endTime: ts("2026-09-21"),
  },
  {
    question: "Will tokenized TSLA exceed $350 before October 2026?",
    collateral: ETH_SENTINEL,
    endTime: ts("2026-09-30"),
  },
  {
    question: "Will RWAForge reach $1M total distribution volume by Oct 2026?",
    collateral: ETH_SENTINEL,
    endTime: ts("2026-10-01"),
  },
  {
    question: "Will Bitcoin exceed $120,000 before October 2026?",
    collateral: ETH_SENTINEL,
    endTime: ts("2026-09-30"),
  },
  {
    question: "Will NVIDIA beat Q3 2026 earnings estimates?",
    collateral: ETH_SENTINEL,
    endTime: ts("2026-11-20"),
  },
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Seeding markets from: ${signer.address}`);
  console.log(`PredictionMarket at:  ${PM_ADDRESS}\n`);

  const pm = new ethers.Contract(PM_ADDRESS, ABI, signer);

  const startId = await pm.nextMarketId();
  console.log(`Next market ID before seeding: ${startId}`);

  for (let i = 0; i < MARKETS.length; i++) {
    const m = MARKETS[i];
    console.log(`Creating market ${Number(startId) + i}: "${m.question}"`);
    const tx = await pm.createMarket(m.question, m.collateral, m.endTime);
    const receipt = await tx.wait();
    console.log(`  ✓ tx: ${receipt.hash}`);
  }

  const endId = await pm.nextMarketId();
  console.log(`\nDone. Markets 0–${Number(endId) - 1} are live on-chain.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
