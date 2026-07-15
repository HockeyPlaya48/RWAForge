import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys the full RWAForge protocol in dependency order:
 *   ForgeToken -> TeamVesting -> Treasury -> DistributionRouter -> RewardClaimer
 * then mints the fixed 1B $FORGE supply out to the four allocation buckets
 * documented in the README, and writes the resulting addresses to
 * contracts/deployments/<network>.json.
 */

const TOTAL_SUPPLY = ethers.parseEther("1000000000"); // 1,000,000,000 FORGE

const ALLOCATIONS = {
  team: (TOTAL_SUPPLY * 15n) / 100n, // 15% -> TeamVesting
  community: (TOTAL_SUPPLY * 30n) / 100n, // 30% -> owner, for airdrops/RewardClaimer funding
  liquidity: (TOTAL_SUPPLY * 25n) / 100n, // 25% -> owner, for DEX liquidity/ecosystem grants
  treasury: (TOTAL_SUPPLY * 30n) / 100n, // 30% -> Treasury
};

const ONE_YEAR = 365 * 24 * 60 * 60;
const THREE_YEARS = 3 * ONE_YEAR;

async function main() {
  const [deployer] = await ethers.getSigners();

  const treasuryOwner = process.env.TREASURY_OWNER || deployer.address;
  const teamBeneficiary = process.env.TEAM_VESTING_BENEFICIARY || deployer.address;

  console.log(`Deploying RWAForge to ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer:        ${deployer.address}`);
  console.log(`Treasury owner:  ${treasuryOwner}`);
  console.log(`Team beneficiary: ${teamBeneficiary}`);

  // 1. ForgeToken
  const ForgeToken = await ethers.getContractFactory("ForgeToken");
  const forgeToken = await ForgeToken.deploy(deployer.address);
  await forgeToken.waitForDeployment();
  const forgeTokenAddress = await forgeToken.getAddress();
  console.log(`ForgeToken deployed:        ${forgeTokenAddress}`);

  // 2. TeamVesting (1yr cliff, 3yr linear, starting now)
  const startTimestamp = Math.floor(Date.now() / 1000);
  const TeamVesting = await ethers.getContractFactory("TeamVesting");
  const teamVesting = await TeamVesting.deploy(
    forgeTokenAddress,
    teamBeneficiary,
    treasuryOwner,
    startTimestamp,
    ONE_YEAR,
    THREE_YEARS
  );
  await teamVesting.waitForDeployment();
  const teamVestingAddress = await teamVesting.getAddress();
  console.log(`TeamVesting deployed:       ${teamVestingAddress}`);

  // 3. Treasury
  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(treasuryOwner);
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log(`Treasury deployed:          ${treasuryAddress}`);

  // 4. DistributionRouter
  const DistributionRouter = await ethers.getContractFactory("DistributionRouter");
  const distributionRouter = await DistributionRouter.deploy(treasuryOwner, treasuryAddress);
  await distributionRouter.waitForDeployment();
  const distributionRouterAddress = await distributionRouter.getAddress();
  console.log(`DistributionRouter deployed: ${distributionRouterAddress}`);

  // 5. RewardClaimer (for $FORGE community/airdrop distribution)
  const RewardClaimer = await ethers.getContractFactory("RewardClaimer");
  const rewardClaimer = await RewardClaimer.deploy(forgeTokenAddress, treasuryOwner);
  await rewardClaimer.waitForDeployment();
  const rewardClaimerAddress = await rewardClaimer.getAddress();
  console.log(`RewardClaimer deployed:      ${rewardClaimerAddress}`);

  // 6. Mint fixed supply out to allocation buckets
  console.log("Minting allocations...");
  await (await forgeToken.mint(teamVestingAddress, ALLOCATIONS.team)).wait();
  await (await forgeToken.mint(treasuryAddress, ALLOCATIONS.treasury)).wait();
  await (await forgeToken.mint(deployer.address, ALLOCATIONS.community)).wait(); // fund RewardClaimer rounds from here
  await (await forgeToken.mint(deployer.address, ALLOCATIONS.liquidity)).wait(); // LP seeding / ecosystem grants

  // 7. Hand ForgeToken ownership to governance if different from deployer
  if (treasuryOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await forgeToken.transferOwnership(treasuryOwner)).wait();
    console.log(`ForgeToken ownership transferred to ${treasuryOwner}`);
  }

  const deployment = {
    network: network.name,
    chainId: network.config.chainId,
    deployedAt: new Date().toISOString(),
    contracts: {
      ForgeToken: forgeTokenAddress,
      TeamVesting: teamVestingAddress,
      Treasury: treasuryAddress,
      DistributionRouter: distributionRouterAddress,
      RewardClaimer: rewardClaimerAddress,
    },
    allocations: {
      team: ALLOCATIONS.team.toString(),
      community: ALLOCATIONS.community.toString(),
      liquidity: ALLOCATIONS.liquidity.toString(),
      treasury: ALLOCATIONS.treasury.toString(),
    },
    governance: {
      treasuryOwner,
      teamBeneficiary,
    },
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2));
  console.log(`Deployment record written to ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
