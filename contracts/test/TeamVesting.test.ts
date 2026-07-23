import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const ONE_YEAR = 365 * 24 * 60 * 60;
const THREE_YEARS = 3 * ONE_YEAR;

describe("TeamVesting", () => {
  async function deploy() {
    const [owner, beneficiary, other] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("RWAForge", "FORGE", 18);
    await token.waitForDeployment();

    const startTimestamp = await time.latest();
    const TeamVesting = await ethers.getContractFactory("TeamVesting");
    const vesting = await TeamVesting.deploy(
      await token.getAddress(),
      beneficiary.address,
      owner.address,
      startTimestamp,
      ONE_YEAR,
      THREE_YEARS
    );
    await vesting.waitForDeployment();

    const totalAllocation = ethers.parseEther("150000000"); // 15% of 1B, matches deploy.ts
    await token.mint(await vesting.getAddress(), totalAllocation);

    return { vesting, token, owner, beneficiary, other, startTimestamp, totalAllocation };
  }

  it("reverts on zero-address token or beneficiary", async () => {
    const [owner, beneficiary] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("RWAForge", "FORGE", 18);
    const TeamVesting = await ethers.getContractFactory("TeamVesting");

    await expect(
      TeamVesting.deploy(ethers.ZeroAddress, beneficiary.address, owner.address, 0, ONE_YEAR, THREE_YEARS)
    ).to.be.revertedWithCustomError(TeamVesting, "ZeroAddress");

    await expect(
      TeamVesting.deploy(await token.getAddress(), ethers.ZeroAddress, owner.address, 0, ONE_YEAR, THREE_YEARS)
    ).to.be.revertedWithCustomError(TeamVesting, "ZeroAddress");
  });

  it("vests nothing before the cliff", async () => {
    const { vesting } = await deploy();
    await time.increase(ONE_YEAR - 60 * 60 * 24 * 7); // one week before cliff
    expect(await vesting.releasable()).to.equal(0n);
  });

  it("reverts release() with nothing vested", async () => {
    const { vesting } = await deploy();
    await expect(vesting.release()).to.be.revertedWithCustomError(vesting, "NothingToRelease");
  });

  it("vests linearly between the cliff and the end of the schedule", async () => {
    const { vesting, totalAllocation, startTimestamp } = await deploy();

    // Halfway through the 3-year vest (measured from start, not from cliff).
    await time.increaseTo(startTimestamp + THREE_YEARS / 2);

    const vested = await vesting.vestedAmount();
    const expected = totalAllocation / 2n;
    // Allow a small tolerance for block timestamp drift across the increaseTo + tx.
    const tolerance = totalAllocation / 1000n;
    expect(vested).to.be.closeTo(expected, tolerance);
  });

  it("vests the full allocation at or after the end of the schedule", async () => {
    const { vesting, totalAllocation, startTimestamp } = await deploy();
    await time.increaseTo(startTimestamp + THREE_YEARS + 1);
    expect(await vesting.vestedAmount()).to.equal(totalAllocation);
  });

  it("releases vested tokens to the beneficiary, and is callable by anyone", async () => {
    const { vesting, token, beneficiary, other, startTimestamp, totalAllocation } = await deploy();
    await time.increaseTo(startTimestamp + THREE_YEARS + 1);

    // Permissionless: `other` triggers release, funds still land with `beneficiary`.
    await expect(vesting.connect(other).release())
      .to.emit(vesting, "TokensReleased")
      .withArgs(beneficiary.address, totalAllocation);

    expect(await token.balanceOf(beneficiary.address)).to.equal(totalAllocation);
    expect(await vesting.released()).to.equal(totalAllocation);
    expect(await vesting.releasable()).to.equal(0n);
  });

  it("supports multiple partial releases over time", async () => {
    const { vesting, token, beneficiary, startTimestamp } = await deploy();

    await time.increaseTo(startTimestamp + THREE_YEARS / 3);
    await vesting.release();
    const firstRelease = await token.balanceOf(beneficiary.address);
    expect(firstRelease).to.be.greaterThan(0n);

    await time.increaseTo(startTimestamp + THREE_YEARS + 1);
    await vesting.release();
    const finalBalance = await token.balanceOf(beneficiary.address);
    expect(finalBalance).to.be.greaterThan(firstRelease);
  });
});
