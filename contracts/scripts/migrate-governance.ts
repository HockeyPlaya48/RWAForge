import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Migrates governance of an existing RWAForge deployment from the current
 * signer (typically a single deployer EOA) to a new owner — normally a Safe
 * multisig. Reads the deployed addresses from
 * contracts/deployments/<network>.json (written by scripts/deploy.ts).
 *
 * Usage:
 *   NEW_GOVERNANCE_OWNER=0xYourSafeAddress npx hardhat run scripts/migrate-governance.ts --network <network>
 */

const OWNABLE_CONTRACTS = ["ForgeToken", "TeamVesting", "DistributionRouter", "RewardClaimer"] as const;

async function main() {
  const newOwner = process.env.NEW_GOVERNANCE_OWNER;
  if (!newOwner || !ethers.isAddress(newOwner)) {
    throw new Error("Set NEW_GOVERNANCE_OWNER to a valid address (e.g. a deployed Safe) before running this script.");
  }

  const code = await ethers.provider.getCode(newOwner);
  if (code === "0x") {
    console.warn(
      `WARNING: ${newOwner} has no deployed bytecode — it looks like an EOA, not a contract/Safe. Continuing anyway.`
    );
  }

  const deploymentPath = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const [signer] = await ethers.getSigners();
  console.log(`Migrating governance on ${network.name} to ${newOwner}`);
  console.log(`Signed by: ${signer.address}`);

  for (const name of OWNABLE_CONTRACTS) {
    const address = deployment.contracts[name];
    const contract = await ethers.getContractAt(name, address);
    const currentOwner: string = await contract.owner();

    if (currentOwner.toLowerCase() === newOwner.toLowerCase()) {
      console.log(`${name} (${address}): already owned by ${newOwner}, skipping`);
      continue;
    }

    console.log(`${name} (${address}): transferOwnership ${currentOwner} -> ${newOwner}`);
    const tx = await contract.transferOwnership(newOwner);
    await tx.wait();
  }

  const treasury = await ethers.getContractAt("Treasury", deployment.contracts.Treasury);
  const DEFAULT_ADMIN_ROLE = await treasury.DEFAULT_ADMIN_ROLE();
  const GOVERNANCE_ROLE = await treasury.GOVERNANCE_ROLE();

  const alreadyAdmin = await treasury.hasRole(DEFAULT_ADMIN_ROLE, newOwner);
  if (!alreadyAdmin) {
    console.log(`Treasury: granting DEFAULT_ADMIN_ROLE to ${newOwner}`);
    await (await treasury.grantRole(DEFAULT_ADMIN_ROLE, newOwner)).wait();
  }

  const alreadyGovernance = await treasury.hasRole(GOVERNANCE_ROLE, newOwner);
  if (!alreadyGovernance) {
    console.log(`Treasury: granting GOVERNANCE_ROLE to ${newOwner}`);
    await (await treasury.grantRole(GOVERNANCE_ROLE, newOwner)).wait();
  }

  const signerHasGovernance = await treasury.hasRole(GOVERNANCE_ROLE, signer.address);
  if (signerHasGovernance) {
    console.log(`Treasury: revoking GOVERNANCE_ROLE from ${signer.address}`);
    await (await treasury.revokeRole(GOVERNANCE_ROLE, signer.address)).wait();
  }

  const signerHasAdmin = await treasury.hasRole(DEFAULT_ADMIN_ROLE, signer.address);
  if (signerHasAdmin) {
    console.log(`Treasury: revoking DEFAULT_ADMIN_ROLE from ${signer.address}`);
    await (await treasury.revokeRole(DEFAULT_ADMIN_ROLE, signer.address)).wait();
  }

  console.log("Governance migration complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
