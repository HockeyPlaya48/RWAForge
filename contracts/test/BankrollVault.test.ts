import { expect } from "chai";
import { ethers } from "hardhat";

const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const DAY = 24 * 60 * 60;

describe("BankrollVault", () => {
  async function deploy() {
    const [owner, resolver, feeRecipient, alice] = await ethers.getSigners();
    const now = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);

    const PredictionMarket = await ethers.getContractFactory("PredictionMarket");
    const predictionMarket = await PredictionMarket.deploy(owner.address, resolver.address, feeRecipient.address);
    await predictionMarket.waitForDeployment();

    const ComboMarket = await ethers.getContractFactory("ComboMarket");
    const comboMarket = await ComboMarket.deploy(owner.address, await predictionMarket.getAddress(), feeRecipient.address);
    await comboMarket.waitForDeployment();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const stock = await MockERC20.deploy("Tokenized Stock", "STK", 18);
    await stock.waitForDeployment();

    const BankrollVault = await ethers.getContractFactory("BankrollVault");
    const vault = await BankrollVault.deploy(owner.address, await predictionMarket.getAddress(), await comboMarket.getAddress());
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();

    // Fund the vault: 1 ETH, 100 STK
    await owner.sendTransaction({ to: vaultAddr, value: ethers.parseEther("1") });
    await stock.mint(vaultAddr, ethers.parseEther("100"));

    // Risk caps: generous headroom so pricing-formula tests aren't cap-limited by default
    await vault.connect(owner).setRiskCaps(ETH_SENTINEL, ethers.parseEther("0.5"), ethers.parseEther("0.5"), ethers.parseEther("1"), 0n);
    await vault.connect(owner).setRiskCaps(await stock.getAddress(), ethers.parseEther("50"), ethers.parseEther("50"), ethers.parseEther("100"), 0n);

    // Pricing: target 1.3x on the heavy side for a "typical" 1 STK / 0.1 ETH bet, vault covers 30% of the gap
    await vault.connect(owner).setPricingParams(ETH_SENTINEL, 13_000, ethers.parseEther("0.1"), 3_000);
    await vault.connect(owner).setPricingParams(await stock.getAddress(), 13_000, ethers.parseEther("1"), 3_000);

    const endTime = now + 2 * DAY;
    await predictionMarket.createMarket("Will X happen?", ETH_SENTINEL, endTime);
    await predictionMarket.createMarket("Will Y happen?", await stock.getAddress(), endTime);
    const ethMarketId = 0n;
    const stockMarketId = 1n;

    return { predictionMarket, comboMarket, vault, vaultAddr, stock, owner, resolver, feeRecipient, alice, ethMarketId, stockMarketId, endTime, now };
  }

  // Mirrors the on-chain formula for assertions: targetThinPool = (heavy + ref) * (M - net) / net
  function computeTargetThinPool(heavy: bigint, ref: bigint, targetBps: bigint, feeBps: bigint) {
    const net = 10_000n - feeBps;
    const numerator = targetBps - net;
    return ((heavy + ref) * numerator) / net;
  }

  describe("_computeTopUp via topUpMarket", () => {
    it("tops up the thin side by only a fraction of the full gap to target", async () => {
      const f = await deploy();
      // Someone bets 1 STK on YES (heavy), leaving NO at 0 (thin)
      await f.stock.mint(f.alice.address, ethers.parseEther("10"));
      await f.stock.connect(f.alice).approve(await f.predictionMarket.getAddress(), ethers.parseEther("10"));
      await f.predictionMarket.connect(f.alice).bet(f.stockMarketId, true, ethers.parseEther("1"));

      const feeBps = await f.predictionMarket.feeBps();
      const target = computeTargetThinPool(ethers.parseEther("1"), ethers.parseEther("1"), 13_000n, feeBps);
      const fullGap = target; // thin pool currently 0
      const expectedTopUp = (fullGap * 3_000n) / 10_000n;

      await expect(f.vault.topUpMarket(f.stockMarketId))
        .to.emit(f.vault, "ToppedUpMarket")
        .withArgs(f.stockMarketId, false, expectedTopUp, target, fullGap, await f.stock.getAddress());

      const m = await f.predictionMarket.getMarket(f.stockMarketId);
      expect(m.noPool).to.equal(expectedTopUp);
      // Sanity: the top-up is meaningfully less than the full gap needed to hit 1.3x outright
      expect(expectedTopUp).to.be.lessThan(fullGap);
    });

    it("results in roughly the target multiplier only when the full gap (not the fraction) is closed", async () => {
      const f = await deploy();
      await f.stock.mint(f.alice.address, ethers.parseEther("10"));
      await f.stock.connect(f.alice).approve(await f.predictionMarket.getAddress(), ethers.parseEther("10"));
      await f.predictionMarket.connect(f.alice).bet(f.stockMarketId, true, ethers.parseEther("1"));

      await f.vault.topUpMarket(f.stockMarketId);
      const m = await f.predictionMarket.getMarket(f.stockMarketId);
      const feeBps = await f.predictionMarket.feeBps();

      // A heavy-side bettor's multiplier after the vault's partial top-up should be
      // modest - well above the ~1.0x "garbage" case, but below the full 1.3x target
      // since the vault only closed 30% of the gap.
      const netBps = 10_000n - feeBps;
      const refBet = ethers.parseEther("1");
      const payablePool = (m.yesPool + m.noPool + refBet) * netBps / 10_000n;
      const multiplier = Number(payablePool) / Number(m.yesPool + refBet);
      expect(multiplier).to.be.greaterThan(1.0);
      expect(multiplier).to.be.lessThan(1.3);
    });

    it("reverts with AlreadyAtTarget once the heavy side already clears the target multiplier", async () => {
      const f = await deploy();
      // Nearly balanced pool already gives a great multiplier on either side
      await f.stock.mint(f.alice.address, ethers.parseEther("10"));
      await f.stock.connect(f.alice).approve(await f.predictionMarket.getAddress(), ethers.parseEther("10"));
      await f.predictionMarket.connect(f.alice).bet(f.stockMarketId, true, ethers.parseEther("1"));
      await f.predictionMarket.connect(f.alice).bet(f.stockMarketId, false, ethers.parseEther("1"));

      await expect(f.vault.topUpMarket(f.stockMarketId)).to.be.revertedWithCustomError(f.vault, "AlreadyAtTarget");
    });

    it("reverts with PoolNotThin once total volume is above the coarse gate", async () => {
      const f = await deploy();
      await f.vault.connect(f.owner).setRiskCaps(await f.stock.getAddress(), ethers.parseEther("50"), ethers.parseEther("50"), ethers.parseEther("0.5"), 0n);
      await f.stock.mint(f.alice.address, ethers.parseEther("10"));
      await f.stock.connect(f.alice).approve(await f.predictionMarket.getAddress(), ethers.parseEther("10"));
      await f.predictionMarket.connect(f.alice).bet(f.stockMarketId, true, ethers.parseEther("1")); // above the 0.5 threshold

      await expect(f.vault.topUpMarket(f.stockMarketId)).to.be.revertedWithCustomError(f.vault, "PoolNotThin");
    });

    it("clamps to the per-market cap even when the fractional gap is larger", async () => {
      const f = await deploy();
      await f.vault.connect(f.owner).setRiskCaps(await f.stock.getAddress(), ethers.parseEther("0.01"), ethers.parseEther("50"), ethers.parseEther("100"), 0n);
      await f.stock.mint(f.alice.address, ethers.parseEther("10"));
      await f.stock.connect(f.alice).approve(await f.predictionMarket.getAddress(), ethers.parseEther("10"));
      await f.predictionMarket.connect(f.alice).bet(f.stockMarketId, true, ethers.parseEther("5"));

      await f.vault.topUpMarket(f.stockMarketId);
      expect(await f.vault.pmStaked(f.stockMarketId)).to.equal(ethers.parseEther("0.01"));
    });

    it("reverts with NotConfigured for a token with no pricing params set", async () => {
      const f = await deploy();
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const other = await MockERC20.deploy("Other", "OTH", 18);
      await other.waitForDeployment();
      const now = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);
      await f.predictionMarket.createMarket("Unconfigured token market", await other.getAddress(), now + DAY);
      await expect(f.vault.topUpMarket(2n)).to.be.revertedWithCustomError(f.vault, "NotConfigured");
    });

    it("reverts when paused", async () => {
      const f = await deploy();
      await f.vault.connect(f.owner).setPaused(true);
      await f.stock.mint(f.alice.address, ethers.parseEther("10"));
      await f.stock.connect(f.alice).approve(await f.predictionMarket.getAddress(), ethers.parseEther("10"));
      await f.predictionMarket.connect(f.alice).bet(f.stockMarketId, true, ethers.parseEther("1"));
      await expect(f.vault.topUpMarket(f.stockMarketId)).to.be.revertedWithCustomError(f.vault, "VaultPaused");
    });
  });

  describe("settlement", () => {
    it("settles and releases exposure after resolution, win or lose", async () => {
      const f = await deploy();
      await f.stock.mint(f.alice.address, ethers.parseEther("10"));
      await f.stock.connect(f.alice).approve(await f.predictionMarket.getAddress(), ethers.parseEther("10"));
      await f.predictionMarket.connect(f.alice).bet(f.stockMarketId, true, ethers.parseEther("1"));
      await f.vault.topUpMarket(f.stockMarketId); // vault bets NO (thin side)

      await ethers.provider.send("evm_increaseTime", [2 * DAY + 1]);
      await ethers.provider.send("evm_mine", []);
      await f.predictionMarket.connect(f.resolver).resolveMarket(f.stockMarketId, true); // NO loses

      const staked = await f.vault.pmStaked(f.stockMarketId);
      await expect(f.vault.settleMarket(f.stockMarketId)).to.emit(f.vault, "MarketSettled").withArgs(f.stockMarketId, staked, 0n);
      expect(await f.vault.totalDeployed(await f.stock.getAddress())).to.equal(0n);
    });
  });

  describe("combos", () => {
    it("tops up a thin combo formulaically", async () => {
      const f = await deploy();
      const now = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);
      const legEnd = now + 2 * DAY;
      await f.predictionMarket.createMarket("Leg A", ETH_SENTINEL, legEnd);
      await f.predictionMarket.createMarket("Leg B", ETH_SENTINEL, legEnd);
      await f.comboMarket.createCombo([2n, 3n], [true, true], ETH_SENTINEL, now + DAY);

      await f.comboMarket.connect(f.alice).betComboETH(0n, true, { value: ethers.parseEther("0.2") });
      await expect(f.vault.topUpCombo(0n)).to.emit(f.vault, "ToppedUpCombo");
      const c = await f.comboMarket.getCombo(0n);
      expect(c.noPool).to.be.greaterThan(0n);
    });
  });

  describe("admin", () => {
    it("only owner can set risk caps, pricing params, pause, or withdraw", async () => {
      const f = await deploy();
      await expect(f.vault.connect(f.alice).setRiskCaps(ETH_SENTINEL, 1, 1, 1, 0)).to.be.revertedWithCustomError(
        f.vault,
        "OwnableUnauthorizedAccount"
      );
      await expect(f.vault.connect(f.alice).setPricingParams(ETH_SENTINEL, 13_000, 1, 3_000)).to.be.revertedWithCustomError(
        f.vault,
        "OwnableUnauthorizedAccount"
      );
      await expect(f.vault.connect(f.alice).setPaused(true)).to.be.revertedWithCustomError(f.vault, "OwnableUnauthorizedAccount");
      await expect(f.vault.connect(f.alice).withdraw(ETH_SENTINEL, 1, f.alice.address)).to.be.revertedWithCustomError(
        f.vault,
        "OwnableUnauthorizedAccount"
      );
    });

    it("rejects a target multiplier at or below 1.0x-equivalent", async () => {
      const f = await deploy();
      await expect(f.vault.connect(f.owner).setPricingParams(ETH_SENTINEL, 10_000, 1, 3_000)).to.be.revertedWithCustomError(
        f.vault,
        "InvalidMultiplier"
      );
    });

    it("rejects a top-up fraction above 100%", async () => {
      const f = await deploy();
      await expect(f.vault.connect(f.owner).setPricingParams(ETH_SENTINEL, 13_000, 1, 10_001)).to.be.revertedWith("fraction > 100%");
    });

    it("owner can withdraw idle balance", async () => {
      const f = await deploy();
      const before = await ethers.provider.getBalance(f.alice.address);
      await f.vault.connect(f.owner).withdraw(ETH_SENTINEL, ethers.parseEther("0.5"), f.alice.address);
      const after = await ethers.provider.getBalance(f.alice.address);
      expect(after - before).to.equal(ethers.parseEther("0.5"));
    });
  });
});
