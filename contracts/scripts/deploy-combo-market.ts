import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys ComboMarket.sol to RH Chain (testnet or mainnet). Requires an already-
 * deployed PredictionMarket to reference.
 *
 * Required env vars:
 *   PRIVATE_KEY             — deployer wallet
 *   PREDICTION_MARKET_ADDR  — deployed PredictionMarket to bundle legs from
 *   TREASURY_OWNER          — will be set as owner + feeRecipient (defaults to deployer)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-combo-market.ts --network robinhoodTestnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  const owner = process.env.TREASURY_OWNER || deployer.address;
  const feeRecipient = owner;
  const predictionMarketAddr = process.env.PREDICTION_MARKET_ADDR;
  if (!predictionMarketAddr) throw new Error("PREDICTION_MARKET_ADDR env var required");

  console.log(`Deploying ComboMarket to ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer:         ${deployer.address}`);
  console.log(`Owner:            ${owner}`);
  console.log(`Fee recipient:    ${feeRecipient}`);
  console.log(`PredictionMarket: ${predictionMarketAddr}`);

  const ComboMarket = await ethers.getContractFactory("ComboMarket");
  const combo = await ComboMarket.deploy(owner, predictionMarketAddr, feeRecipient);
  await combo.waitForDeployment();
  const address = await combo.getAddress();

  console.log(`\nComboMarket deployed: ${address}`);
  console.log(`\nAdd to Vercel env vars:`);
  console.log(`  NEXT_PUBLIC_COMBO_MARKET_ADDRESS=${address}`);

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.combo-market.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      { network: network.name, chainId: network.config.chainId, ComboMarket: address, PredictionMarket: predictionMarketAddr },
      null,
      2
    )
  );
  console.log(`\nDeployment record: ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
