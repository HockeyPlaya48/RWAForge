import { expect } from "chai";
import { ethers } from "hardhat";

describe("ForgeToken", () => {
  async function deploy() {
    const [owner, alice] = await ethers.getSigners();
    const ForgeToken = await ethers.getContractFactory("ForgeToken");
    const token = await ForgeToken.deploy(owner.address);
    await token.waitForDeployment();
    return { token, owner, alice };
  }

  it("has correct name, symbol, and starts at zero supply", async () => {
    const { token } = await deploy();
    expect(await token.name()).to.equal("RWAForge");
    expect(await token.symbol()).to.equal("FORGE");
    expect(await token.totalSupply()).to.equal(0n);
  });

  it("caps total supply at 1,000,000,000 FORGE", async () => {
    const { token, owner } = await deploy();
    const max = await token.MAX_SUPPLY();
    expect(max).to.equal(ethers.parseEther("1000000000"));

    await token.mint(owner.address, max);
    await expect(token.mint(owner.address, 1n)).to.be.revertedWithCustomError(
      token,
      "MaxSupplyExceeded"
    );
  });

  it("only owner can mint", async () => {
    const { token, alice } = await deploy();
    await expect(token.connect(alice).mint(alice.address, 1n)).to.be.revertedWithCustomError(
      token,
      "OwnableUnauthorizedAccount"
    );
  });

  it("pausing blocks transfers", async () => {
    const { token, owner, alice } = await deploy();
    await token.mint(owner.address, ethers.parseEther("100"));
    await token.pause();
    await expect(token.transfer(alice.address, 1n)).to.be.revertedWithCustomError(
      token,
      "EnforcedPause"
    );
    await token.unpause();
    await expect(token.transfer(alice.address, 1n)).to.not.be.reverted;
  });

  it("supports burning", async () => {
    const { token, owner } = await deploy();
    await token.mint(owner.address, ethers.parseEther("10"));
    await token.burn(ethers.parseEther("4"));
    expect(await token.totalSupply()).to.equal(ethers.parseEther("6"));
  });
});
