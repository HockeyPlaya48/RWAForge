import { expect } from "chai";
import { ethers } from "hardhat";

describe("DistributionRouter", () => {
  async function deploy() {
    const [owner, treasury, alice, bob] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Stock Token", "STOCK", 18);
    await token.waitForDeployment();

    const DistributionRouter = await ethers.getContractFactory("DistributionRouter");
    const router = await DistributionRouter.deploy(owner.address, treasury.address);
    await router.waitForDeployment();

    await token.mint(owner.address, ethers.parseEther("1000"));
    await token.connect(owner).approve(await router.getAddress(), ethers.MaxUint256);

    return { router, token, owner, treasury, alice, bob };
  }

  it("defaults to a 3% fee", async () => {
    const { router } = await deploy();
    expect(await router.feeBps()).to.equal(300n);
  });

  it("distributes exact amounts and routes fee to treasury", async () => {
    const { router, token, owner, treasury, alice, bob } = await deploy();

    const amounts = [ethers.parseEther("100"), ethers.parseEther("50")];
    const total = amounts[0] + amounts[1];
    const expectedFee = (total * 300n) / 10_000n;

    await expect(
      router.connect(owner).distribute(await token.getAddress(), [alice.address, bob.address], amounts)
    )
      .to.emit(router, "DistributionExecuted")
      .withArgs(owner.address, await token.getAddress(), 2, total, expectedFee);

    expect(await token.balanceOf(alice.address)).to.equal(amounts[0]);
    expect(await token.balanceOf(bob.address)).to.equal(amounts[1]);
    expect(await token.balanceOf(treasury.address)).to.equal(expectedFee);
  });

  it("rejects mismatched array lengths and empty batches", async () => {
    const { router, token, owner, alice } = await deploy();
    await expect(
      router.connect(owner).distribute(await token.getAddress(), [alice.address], [])
    ).to.be.revertedWithCustomError(router, "InvalidBatch");
    await expect(
      router.connect(owner).distribute(await token.getAddress(), [], [])
    ).to.be.revertedWithCustomError(router, "InvalidBatch");
  });

  it("rejects zero recipient and zero amount", async () => {
    const { router, token, owner, alice } = await deploy();
    await expect(
      router.connect(owner).distribute(await token.getAddress(), [ethers.ZeroAddress], [1n])
    ).to.be.revertedWithCustomError(router, "ZeroRecipient");
    await expect(
      router.connect(owner).distribute(await token.getAddress(), [alice.address], [0n])
    ).to.be.revertedWithCustomError(router, "ZeroAmount");
  });

  it("enforces fee bounds of 1-5%", async () => {
    const { router, owner } = await deploy();
    await expect(router.connect(owner).setFeeBps(50n)).to.be.revertedWithCustomError(
      router,
      "FeeOutOfBounds"
    );
    await expect(router.connect(owner).setFeeBps(600n)).to.be.revertedWithCustomError(
      router,
      "FeeOutOfBounds"
    );
    await router.connect(owner).setFeeBps(500n);
    expect(await router.feeBps()).to.equal(500n);
  });

  it("only owner can update fee or treasury", async () => {
    const { router, alice } = await deploy();
    await expect(router.connect(alice).setFeeBps(200n)).to.be.revertedWithCustomError(
      router,
      "OwnableUnauthorizedAccount"
    );
    await expect(router.connect(alice).setTreasury(alice.address)).to.be.revertedWithCustomError(
      router,
      "OwnableUnauthorizedAccount"
    );
  });

  it("blocks distribution while paused", async () => {
    const { router, token, owner, alice } = await deploy();
    await router.connect(owner).pause();
    await expect(
      router.connect(owner).distribute(await token.getAddress(), [alice.address], [1n])
    ).to.be.revertedWithCustomError(router, "EnforcedPause");
  });
});
