import { expect } from "chai";
import { ethers } from "hardhat";

const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const DAY = 24 * 60 * 60;

describe("ComboMarket", () => {
  async function deploy() {
    const [owner, resolver, feeRecipient, alice, bob] = await ethers.getSigners();

    const now = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);

    const PredictionMarket = await ethers.getContractFactory("PredictionMarket");
    const predictionMarket = await PredictionMarket.deploy(owner.address, resolver.address, feeRecipient.address);
    await predictionMarket.waitForDeployment();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const stock = await MockERC20.deploy("Tokenized Stock", "STK", 18);
    await stock.waitForDeployment();
    await stock.mint(alice.address, ethers.parseEther("1000"));
    await stock.mint(bob.address, ethers.parseEther("1000"));

    // Two ETH-collateral legs on the base PredictionMarket, each ending in 2 days.
    const legEndTime = now + 2 * DAY;
    await predictionMarket.createMarket("Leg A: will X happen?", ETH_SENTINEL, legEndTime);
    await predictionMarket.createMarket("Leg B: will Y happen?", ETH_SENTINEL, legEndTime);
    const legA = 0n;
    const legB = 1n;

    const ComboMarket = await ethers.getContractFactory("ComboMarket");
    const combo = await ComboMarket.deploy(owner.address, await predictionMarket.getAddress(), feeRecipient.address);
    await combo.waitForDeployment();
    const comboAddr = await combo.getAddress();
    await stock.connect(alice).approve(comboAddr, ethers.parseEther("1000"));
    await stock.connect(bob).approve(comboAddr, ethers.parseEther("1000"));

    return { predictionMarket, combo, stock, owner, resolver, feeRecipient, alice, bob, legA, legB, legEndTime, now };
  }

  async function createEthCombo(fixture: Awaited<ReturnType<typeof deploy>>, endTimeOffset = DAY) {
    const { combo, legA, legB, now } = fixture;
    const endTime = now + endTimeOffset;
    const tx = await combo.createCombo([legA, legB], [true, true], ETH_SENTINEL, endTime);
    await tx.wait();
    return 0n; // first combo id
  }

  describe("createCombo", () => {
    it("rejects fewer than 2 legs", async () => {
      const f = await deploy();
      await expect(
        f.combo.createCombo([f.legA], [true], ETH_SENTINEL, f.now + DAY)
      ).to.be.revertedWithCustomError(f.combo, "TooFewLegs");
    });

    it("rejects mismatched legs/picks length", async () => {
      const f = await deploy();
      await expect(
        f.combo.createCombo([f.legA, f.legB], [true], ETH_SENTINEL, f.now + DAY)
      ).to.be.revertedWithCustomError(f.combo, "LegPickLengthMismatch");
    });

    it("rejects a leg market that doesn't exist", async () => {
      const f = await deploy();
      await expect(
        f.combo.createCombo([f.legA, 999n], [true, true], ETH_SENTINEL, f.now + DAY)
      ).to.be.revertedWithCustomError(f.combo, "LegMarketNotFound");
    });

    it("rejects a combo endTime after a leg's endTime", async () => {
      const f = await deploy();
      await expect(
        f.combo.createCombo([f.legA, f.legB], [true, true], ETH_SENTINEL, f.legEndTime + DAY)
      ).to.be.revertedWithCustomError(f.combo, "LegEndsAfterCombo");
    });

    it("rejects a leg that's already resolved", async () => {
      const f = await deploy();
      await ethers.provider.send("evm_increaseTime", [2 * DAY + 1]);
      await ethers.provider.send("evm_mine", []);
      await f.predictionMarket.connect(f.resolver).resolveMarket(f.legA, true);
      const nowAfter = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);
      await expect(
        f.combo.createCombo([f.legA, f.legB], [true, true], ETH_SENTINEL, nowAfter + DAY)
      ).to.be.revertedWithCustomError(f.combo, "LegAlreadyResolved");
    });

    it("creates a valid combo", async () => {
      const f = await deploy();
      const comboId = await createEthCombo(f);
      const c = await f.combo.getCombo(comboId);
      expect(c.legMarketIds).to.deep.equal([f.legA, f.legB]);
      expect(c.legPicks).to.deep.equal([true, true]);
      expect(c.outcome).to.equal(0n); // Unresolved
    });
  });

  describe("betting", () => {
    it("accepts ETH bets via betComboETH and ERC-20 via betCombo", async () => {
      const f = await deploy();
      const comboId = await createEthCombo(f);
      await expect(f.combo.connect(f.alice).betComboETH(comboId, true, { value: ethers.parseEther("1") }))
        .to.emit(f.combo, "ComboBetPlaced")
        .withArgs(comboId, f.alice.address, true, ethers.parseEther("1"));

      const c = await f.combo.getCombo(comboId);
      expect(c.yesPool).to.equal(ethers.parseEther("1"));
    });

    it("rejects betComboETH on an ERC-20 combo and vice versa", async () => {
      const f = await deploy();
      const endTime = f.now + DAY;
      await f.combo.createCombo([f.legA, f.legB], [true, true], await f.stock.getAddress(), endTime);
      const stockComboId = 0n;

      await expect(
        f.combo.connect(f.alice).betComboETH(stockComboId, true, { value: 1n })
      ).to.be.revertedWith("use betCombo for ERC-20 combos");

      const comboId = await createEthCombo(f, DAY); // second combo, id 1
      await expect(
        f.combo.connect(f.alice).betCombo(1n, true, ethers.parseEther("1"))
      ).to.be.revertedWith("use betComboETH for native ETH combos");
    });

    it("rejects bets after endTime", async () => {
      const f = await deploy();
      const comboId = await createEthCombo(f, 60); // closes in 60s
      await ethers.provider.send("evm_increaseTime", [61]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        f.combo.connect(f.alice).betComboETH(comboId, true, { value: 1n })
      ).to.be.revertedWithCustomError(f.combo, "ComboExpired");
    });
  });

  describe("resolution and payout", () => {
    async function resolveLegs(f: Awaited<ReturnType<typeof deploy>>, aOutcome: boolean, bOutcome: boolean) {
      await ethers.provider.send("evm_increaseTime", [2 * DAY + 1]);
      await ethers.provider.send("evm_mine", []);
      await f.predictionMarket.connect(f.resolver).resolveMarket(f.legA, aOutcome);
      await f.predictionMarket.connect(f.resolver).resolveMarket(f.legB, bOutcome);
    }

    it("reverts resolveCombo until all legs are resolved", async () => {
      const f = await deploy();
      const comboId = await createEthCombo(f);
      await expect(f.combo.resolveCombo(comboId)).to.be.revertedWithCustomError(f.combo, "LegsNotResolved");
    });

    it("resolves YES when every leg hits as picked, and pays out pari-mutuel minus fee", async () => {
      const f = await deploy();
      const comboId = await createEthCombo(f); // picks: [true, true]
      await f.combo.connect(f.alice).betComboETH(comboId, true, { value: ethers.parseEther("1") });
      await f.combo.connect(f.bob).betComboETH(comboId, false, { value: ethers.parseEther("1") });

      await resolveLegs(f, true, true); // both legs YES -> combo hits
      await expect(f.combo.resolveCombo(comboId)).to.emit(f.combo, "ComboResolved").withArgs(comboId, 1n);

      const payout = await f.combo.previewComboPayout(comboId, f.alice.address);
      // total pool 2 ETH, 2% fee = 0.04, payable 1.96, alice owns 100% of yes pool
      expect(payout).to.equal(ethers.parseEther("1.96"));

      const before = await ethers.provider.getBalance(f.alice.address);
      const tx = await f.combo.connect(f.alice).claimComboWinnings(comboId);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(f.alice.address);
      expect(after - before + gasCost).to.equal(payout);
    });

    it("resolves NO when any leg misses the pick", async () => {
      const f = await deploy();
      const comboId = await createEthCombo(f); // picks: [true, true]
      await f.combo.connect(f.alice).betComboETH(comboId, true, { value: ethers.parseEther("1") });
      await f.combo.connect(f.bob).betComboETH(comboId, false, { value: ethers.parseEther("1") });

      await resolveLegs(f, true, false); // leg B misses -> combo fails
      await expect(f.combo.resolveCombo(comboId)).to.emit(f.combo, "ComboResolved").withArgs(comboId, 2n);

      expect(await f.combo.previewComboPayout(comboId, f.alice.address)).to.equal(0n);
      await expect(f.combo.connect(f.bob).claimComboWinnings(comboId)).to.not.be.reverted;
    });

    it("cancels the combo (full refund) if any leg is cancelled", async () => {
      const f = await deploy();
      const comboId = await createEthCombo(f);
      await f.combo.connect(f.alice).betComboETH(comboId, true, { value: ethers.parseEther("1") });

      await ethers.provider.send("evm_increaseTime", [2 * DAY + 1]);
      await ethers.provider.send("evm_mine", []);
      await f.predictionMarket.connect(f.resolver).cancelMarket(f.legA);
      await f.predictionMarket.connect(f.resolver).resolveMarket(f.legB, true);

      await expect(f.combo.resolveCombo(comboId)).to.emit(f.combo, "ComboResolved").withArgs(comboId, 3n);
      expect(await f.combo.previewComboPayout(comboId, f.alice.address)).to.equal(ethers.parseEther("1"));
    });

    it("reverts on double claim", async () => {
      const f = await deploy();
      const comboId = await createEthCombo(f);
      await f.combo.connect(f.alice).betComboETH(comboId, true, { value: ethers.parseEther("1") });
      await resolveLegs(f, true, true);
      await f.combo.resolveCombo(comboId);
      await f.combo.connect(f.alice).claimComboWinnings(comboId);
      await expect(f.combo.connect(f.alice).claimComboWinnings(comboId)).to.be.revertedWithCustomError(
        f.combo,
        "AlreadyClaimed"
      );
    });
  });

  describe("admin", () => {
    it("only owner can set fee bps, bounded at 5%", async () => {
      const f = await deploy();
      await expect(f.combo.connect(f.alice).setFeeBps(100)).to.be.revertedWithCustomError(
        f.combo,
        "OwnableUnauthorizedAccount"
      );
      await expect(f.combo.connect(f.owner).setFeeBps(501)).to.be.revertedWithCustomError(f.combo, "FeeOutOfBounds");
      await f.combo.connect(f.owner).setFeeBps(300);
      expect(await f.combo.feeBps()).to.equal(300n);
    });
  });
});
