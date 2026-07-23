import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys PredictionMarket.sol to RH Chain (testnet or mainnet).
 *
 * Required env vars:
 *   PRIVATE_KEY            — deployer wallet
 *   TREASURY_OWNER         — will be set as owner + feeRecipient (defaults to deployer)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-prediction-market.ts --network robinhoodTestnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  const owner = process.env.TREASURY_OWNER || deployer.address;
  const resolver = owner; // can update post-deploy via setResolver()
  const feeRecipient = owner;

  console.log(`Deploying PredictionMarket to ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer:      ${deployer.address}`);
  console.log(`Owner:         ${owner}`);
  console.log(`Resolver:      ${resolver}`);
  console.log(`Fee recipient: ${feeRecipient}`);

  const PredictionMarket = await ethers.getContractFactory("PredictionMarket");
  const pm = await PredictionMarket.deploy(owner, resolver, feeRecipient);
  await pm.waitForDeployment();
  const address = await pm.getAddress();

  console.log(`\nPredictionMarket deployed: ${address}`);
  console.log(`\nAdd to Vercel env vars:`);
  console.log(`  NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS=${address}`);

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.prediction-market.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify({ network: network.name, chainId: network.config.chainId, PredictionMarket: address }, null, 2)
  );
  console.log(`\nDeployment record: ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
