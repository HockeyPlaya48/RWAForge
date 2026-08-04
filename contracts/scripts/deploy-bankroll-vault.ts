import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys BankrollVault.sol to RH Chain (testnet or mainnet). Requires already-
 * deployed PredictionMarket and ComboMarket contracts.
 *
 * Required env vars:
 *   PRIVATE_KEY             — deployer wallet
 *   PREDICTION_MARKET_ADDR  — deployed PredictionMarket
 *   COMBO_MARKET_ADDR       — deployed ComboMarket
 *   TREASURY_OWNER          — will be set as owner (defaults to deployer)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-bankroll-vault.ts --network robinhoodTestnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  const owner = process.env.TREASURY_OWNER || deployer.address;
  const predictionMarketAddr = process.env.PREDICTION_MARKET_ADDR;
  const comboMarketAddr = process.env.COMBO_MARKET_ADDR;
  if (!predictionMarketAddr || !comboMarketAddr) {
    throw new Error("PREDICTION_MARKET_ADDR and COMBO_MARKET_ADDR env vars are required");
  }

  console.log(`Deploying BankrollVault to ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer:         ${deployer.address}`);
  console.log(`Owner:            ${owner}`);
  console.log(`PredictionMarket: ${predictionMarketAddr}`);
  console.log(`ComboMarket:      ${comboMarketAddr}`);

  const BankrollVault = await ethers.getContractFactory("BankrollVault");
  const vault = await BankrollVault.deploy(owner, predictionMarketAddr, comboMarketAddr);
  await vault.waitForDeployment();
  const address = await vault.getAddress();

  console.log(`\nBankrollVault deployed: ${address}`);
  console.log(`\nAdd to Vercel env vars:`);
  console.log(`  NEXT_PUBLIC_BANKROLL_VAULT_ADDRESS=${address}`);

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.bankroll-vault.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      { network: network.name, chainId: network.config.chainId, BankrollVault: address, PredictionMarket: predictionMarketAddr, ComboMarket: comboMarketAddr },
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
