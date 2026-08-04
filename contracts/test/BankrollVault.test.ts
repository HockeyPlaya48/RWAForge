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

    // Default caps: perMarket 0.1 ETH / 10 STK, global 0.5 ETH / 50 STK, min depth 1 ETH / 100 STK, floor 0
    await vault.connect(owner).setCaps(ETH_SENTINEL, ethers.parseEther("0.1"), ethers.parseEther("0.5"), ethers.parseEther("1"), 0n);
    await vault.connect(owner).setCaps(await stock.getAddress(), ethers.parseEther("10"), ethers.parseEther("50"), ethers.parseEther("100"), 0n);

    const endTime = now + 2 * DAY;
    await predictionMarket.createMarket("Will X happen?", ETH_SENTINEL, endTime);
    await predictionMarket.createMarket("Will Y happen?", await stock.getAddress(), endTime);
    const ethMarketId = 0n;
    const stockMarketId = 1n;

    return { predictionMarket, comboMarket, vault, vaultAddr, stock, owner, resolver, feeRecipient, alice, ethMarketId, stockMarketId, endTime, now };
  }

  describe("topUpMarketETH", () => {
    it("tops up the thin (empty) side when pool is below threshold", async () => {
      const f = await deploy();
      await expect(f.vault.topUpMarketETH(f.ethMarketId, true, ethers.parseEther("0.05")))
        .to.emit(f.vault, "ToppedUpMarket")
        .withArgs(f.ethMarketId, true, ethers.parseEther("0.05"), ETH_SENTINEL);

      const m = await f.predictionMarket.getMarket(f.ethMarketId);
      expect(m.yesPool).to.equal(ethers.parseEther("0.05"));
      expect(await f.vault.pmStaked(f.ethMarketId)).to.equal(ethers.parseEther("0.05"));
      expect(await f.vault.totalDeployed(ETH_SENTINEL)).to.equal(ethers.parseEther("0.05"));
    });

    it("refuses to top up the heavier side", async () => {
      const f = await deploy();
      // Someone bets 0.2 ETH on YES directly (still below the 1 ETH min-depth threshold)
      await f.predictionMarket.connect(f.alice).betETH(f.ethMarketId, true, { value: ethers.parseEther("0.2") });
      await expect(f.vault.topUpMarketETH(f.ethMarketId, true, ethers.parseEther("0.01"))).to.be.revertedWithCustomError(
        f.vault,
        "NotTheThinSide"
      );
      // Topping up NO (the actually-thin side) is fine
      await expect(f.vault.topUpMarketETH(f.ethMarketId, false, ethers.parseEther("0.01"))).to.not.be.reverted;
    });

    it("refuses to top up once the pool is no longer thin", async () => {
      const f = await deploy();
      await f.predictionMarket.connect(f.alice).betETH(f.ethMarketId, true, { value: ethers.parseEther("0.6") });
      await f.predictionMarket.connect(f.alice).betETH(f.ethMarketId, false, { value: ethers.parseEther("0.6") });
      // total is now 1.2 ETH, above the 1 ETH threshold
      await expect(f.vault.topUpMarketETH(f.ethMarketId, true, ethers.parseEther("0.01"))).to.be.revertedWithCustomError(
        f.vault,
        "PoolNotThin"
      );
    });

    it("enforces the per-market cap across repeated top-ups", async () => {
      const f = await deploy();
      await f.vault.topUpMarketETH(f.ethMarketId, true, ethers.parseEther("0.08"));
      // NO is now the thin side (0 vs 0.08) - top it up further, past the per-market cap
      await expect(f.vault.topUpMarketETH(f.ethMarketId, false, ethers.parseEther("0.05"))).to.be.revertedWithCustomError(
        f.vault,
        "PerMarketCapExceeded"
      );
    });

    it("enforces the global cap across different markets", async () => {
      const f = await deploy();
      const now = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);
      // Create 5 more thin ETH markets (ids 2-6; id 1 is the stock market from deploy()), cap perMarket 0.1 but global only 0.5
      for (let i = 0; i < 5; i++) {
        await f.predictionMarket.createMarket(`Extra market ${i}`, ETH_SENTINEL, now + 2 * DAY);
      }
      const ethMarketIds = [0, 2, 3, 4, 5];
      for (const id of ethMarketIds) {
        await f.vault.topUpMarketETH(id, true, ethers.parseEther("0.1"));
      }
      // 5 * 0.1 = 0.5 already deployed, global cap reached
      await expect(f.vault.topUpMarketETH(6, true, ethers.parseEther("0.01"))).to.be.revertedWithCustomError(
        f.vault,
        "GlobalCapExceeded"
      );
    });

    it("enforces the circuit-breaker floor balance", async () => {
      const f = await deploy();
      await f.vault.connect(f.owner).setCaps(ETH_SENTINEL, ethers.parseEther("1"), ethers.parseEther("1"), ethers.parseEther("1"), ethers.parseEther("0.97"));
      // Vault holds 1 ETH, floor is 0.97 -> only 0.03 ETH deployable
      await expect(f.vault.topUpMarketETH(f.ethMarketId, true, ethers.parseEther("0.05"))).to.be.revertedWithCustomError(
        f.vault,
        "CircuitBreakerFloor"
      );
      await expect(f.vault.topUpMarketETH(f.ethMarketId, true, ethers.parseEther("0.02"))).to.not.be.reverted;
    });

    it("reverts when paused", async () => {
      const f = await deploy();
      await f.vault.connect(f.owner).setPaused(true);
      await expect(f.vault.topUpMarketETH(f.ethMarketId, true, ethers.parseEther("0.01"))).to.be.revertedWithCustomError(
        f.vault,
        "VaultPaused"
      );
    });
  });

  describe("topUpMarket (ERC-20)", () => {
    it("tops up an ERC-20 market and settles after resolution", async () => {
      const f = await deploy();
      await f.vault.topUpMarket(f.stockMarketId, true, ethers.parseEther("5"));
      expect(await f.vault.pmStaked(f.stockMarketId)).to.equal(ethers.parseEther("5"));

      await ethers.provider.send("evm_increaseTime", [2 * DAY + 1]);
      await ethers.provider.send("evm_mine", []);
      await f.predictionMarket.connect(f.resolver).resolveMarket(f.stockMarketId, true);

      await expect(f.vault.settleMarket(f.stockMarketId)).to.emit(f.vault, "MarketSettled");
      expect(await f.vault.pmStaked(f.stockMarketId)).to.equal(0n);
      expect(await f.vault.totalDeployed(await f.stock.getAddress())).to.equal(0n);
    });

    it("releases exposure even when the vault's position loses", async () => {
      const f = await deploy();
      await f.vault.topUpMarket(f.stockMarketId, true, ethers.parseEther("5"));

      await ethers.provider.send("evm_increaseTime", [2 * DAY + 1]);
      await ethers.provider.send("evm_mine", []);
      await f.predictionMarket.connect(f.resolver).resolveMarket(f.stockMarketId, false); // vault bet YES, loses

      await expect(f.vault.settleMarket(f.stockMarketId)).to.emit(f.vault, "MarketSettled").withArgs(f.stockMarketId, ethers.parseEther("5"), 0n);
      expect(await f.vault.totalDeployed(await f.stock.getAddress())).to.equal(0n);
    });
  });

  describe("combos", () => {
    async function setupCombo(f: Awaited<ReturnType<typeof deploy>>) {
      const now = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);
      const legEnd = now + 2 * DAY;
      await f.predictionMarket.createMarket("Leg A", ETH_SENTINEL, legEnd);
      await f.predictionMarket.createMarket("Leg B", ETH_SENTINEL, legEnd);
      const legA = 2n; // ids 0,1 already used by deploy()
      const legB = 3n;
      await f.comboMarket.createCombo([legA, legB], [true, true], ETH_SENTINEL, now + DAY);
      return { legA, legB, comboId: 0n };
    }

    it("tops up a thin combo and settles on resolution", async () => {
      const f = await deploy();
      const { legA, legB, comboId } = await setupCombo(f);

      await expect(f.vault.topUpComboETH(comboId, true, ethers.parseEther("0.05")))
        .to.emit(f.vault, "ToppedUpCombo")
        .withArgs(comboId, true, ethers.parseEther("0.05"), ETH_SENTINEL);

      await ethers.provider.send("evm_increaseTime", [2 * DAY + 1]);
      await ethers.provider.send("evm_mine", []);
      await f.predictionMarket.connect(f.resolver).resolveMarket(legA, true);
      await f.predictionMarket.connect(f.resolver).resolveMarket(legB, true);
      await f.comboMarket.resolveCombo(comboId);

      await expect(f.vault.settleCombo(comboId)).to.emit(f.vault, "ComboSettled");
      expect(await f.vault.comboStaked(comboId)).to.equal(0n);
    });
  });

  describe("admin", () => {
    it("only owner can set caps, pause, or withdraw", async () => {
      const f = await deploy();
      await expect(f.vault.connect(f.alice).setCaps(ETH_SENTINEL, 1, 1, 1, 0)).to.be.revertedWithCustomError(
        f.vault,
        "OwnableUnauthorizedAccount"
      );
      await expect(f.vault.connect(f.alice).setPaused(true)).to.be.revertedWithCustomError(f.vault, "OwnableUnauthorizedAccount");
      await expect(f.vault.connect(f.alice).withdraw(ETH_SENTINEL, 1, f.alice.address)).to.be.revertedWithCustomError(
        f.vault,
        "OwnableUnauthorizedAccount"
      );
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
