import { expect } from "chai";
import { ethers } from "hardhat";

describe("Treasury", () => {
  async function deploy() {
    const [governance, operator, other] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const feeToken = await MockERC20.deploy("Fee Token", "FEE", 18);
    await feeToken.waitForDeployment();
    const rwaToken = await MockERC20.deploy("RWA Stock", "RWAX", 18);
    await rwaToken.waitForDeployment();

    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy(governance.address);
    await treasury.waitForDeployment();

    const MockSwapRouter = await ethers.getContractFactory("MockSwapRouter");
    const swapRouter = await MockSwapRouter.deploy();
    await swapRouter.waitForDeployment();

    const operatorRole = await treasury.OPERATOR_ROLE();
    await treasury.connect(governance).grantRole(operatorRole, operator.address);

    await feeToken.mint(await treasury.getAddress(), ethers.parseEther("1000"));

    return { treasury, feeToken, rwaToken, swapRouter, governance, operator, other };
  }

  it("only governance can toggle supported RWAs", async () => {
    const { treasury, rwaToken, governance, other } = await deploy();
    await expect(
      treasury.connect(other).setSupportedRWA(await rwaToken.getAddress(), true)
    ).to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount");

    await treasury.connect(governance).setSupportedRWA(await rwaToken.getAddress(), true);
    expect(await treasury.isSupportedRWA(await rwaToken.getAddress())).to.equal(true);
  });

  it("only OPERATOR_ROLE can execute swaps, and only into supported RWAs", async () => {
    const { treasury, feeToken, rwaToken, swapRouter, governance, operator, other } = await deploy();

    await expect(
      treasury
        .connect(other)
        .executeSwap(
          await swapRouter.getAddress(),
          await feeToken.getAddress(),
          await rwaToken.getAddress(),
          ethers.parseEther("100"),
          0n
        )
    ).to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount");

    await expect(
      treasury
        .connect(operator)
        .executeSwap(
          await swapRouter.getAddress(),
          await feeToken.getAddress(),
          await rwaToken.getAddress(),
          ethers.parseEther("100"),
          0n
        )
    ).to.be.revertedWithCustomError(treasury, "UnsupportedRWA");

    await treasury.connect(governance).setSupportedRWA(await rwaToken.getAddress(), true);

    await expect(
      treasury
        .connect(operator)
        .executeSwap(
          await swapRouter.getAddress(),
          await feeToken.getAddress(),
          await rwaToken.getAddress(),
          ethers.parseEther("100"),
          0n
        )
    ).to.emit(treasury, "RWASwapExecuted");

    expect(await rwaToken.balanceOf(await treasury.getAddress())).to.equal(ethers.parseEther("100"));
    expect(await treasury.rwaHoldings(await rwaToken.getAddress())).to.equal(ethers.parseEther("100"));
  });

  it("only governance can withdraw", async () => {
    const { treasury, feeToken, governance, other } = await deploy();
    await expect(
      treasury.connect(other).withdraw(await feeToken.getAddress(), other.address, 1n)
    ).to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount");

    await treasury.connect(governance).withdraw(await feeToken.getAddress(), other.address, ethers.parseEther("10"));
    expect(await feeToken.balanceOf(other.address)).to.equal(ethers.parseEther("10"));
  });
});
