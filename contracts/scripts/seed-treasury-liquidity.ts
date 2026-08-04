import { ethers } from "hardhat";
import { formatEther, formatUnits, parseUnits } from "ethers";

/**
 * Seeds thin markets/combos with a small treasury bet on both sides (same
 * collateral as the market itself - no swaps, no conversion) so pools aren't
 * sitting at zero for the first real bettor. Skips anything already above a
 * volume threshold so it never distorts a market that already has real activity.
 *
 * Re-run this after creating new markets/combos to keep them seeded.
 *
 * Usage:
 *   PREDICTION_MARKET_ADDR=0x... COMBO_MARKET_ADDR=0x... TSLA_ADDR=0x... \
 *     npx hardhat run scripts/seed-treasury-liquidity.ts --network robinhoodTestnet
 */

const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ETH_MARKET_IDS = [0, 1, 2, 3, 4, 5, 7, 8, 9];
const TSLA_MARKET_IDS = [6, 10, 11, 12];
const ETH_SEED_AMOUNT = parseUnits("0.0001", 18);
const TSLA_SEED_AMOUNT = parseUnits("0.05", 18);
const ETH_VOLUME_THRESHOLD = parseUnits("0.0005", 18);
const TSLA_VOLUME_THRESHOLD = parseUnits("0.3", 18);
const COMBO_TSLA_SEED_AMOUNT = parseUnits("0.1", 18);

async function main() {
  const pmAddr = process.env.PREDICTION_MARKET_ADDR;
  const comboAddr = process.env.COMBO_MARKET_ADDR;
  const tslaAddr = process.env.TSLA_ADDR;
  if (!pmAddr || !comboAddr || !tslaAddr) {
    throw new Error("PREDICTION_MARKET_ADDR, COMBO_MARKET_ADDR, and TSLA_ADDR env vars are required");
  }

  const [signer] = await ethers.getSigners();
  const pm = await ethers.getContractAt("PredictionMarket", pmAddr, signer);
  const combo = await ethers.getContractAt("ComboMarket", comboAddr, signer);
  const tsla = await ethers.getContractAt("IERC20", tslaAddr, signer);

  console.log("Treasury ETH:", formatEther(await ethers.provider.getBalance(signer.address)));
  console.log("Treasury TSLA:", formatUnits(await tsla.balanceOf(signer.address), 18));

  for (const spender of [pmAddr, comboAddr]) {
    const allowance = await tsla.allowance(signer.address, spender);
    if (allowance < parseUnits("1", 18)) {
      console.log(`Approving 1 TSLA for ${spender}...`);
      await (await tsla.approve(spender, parseUnits("1", 18))).wait();
    }
  }

  console.log("\n--- ETH markets ---");
  for (const id of ETH_MARKET_IDS) {
    const m = await pm.getMarket(id);
    if (Number(m.outcome) !== 0) { console.log(`Market ${id}: resolved, skip`); continue; }
    if (m.yesPool + m.noPool >= ETH_VOLUME_THRESHOLD) { console.log(`Market ${id}: already has volume, skip`); continue; }
    console.log(`Market ${id}: seeding both sides with ${formatEther(ETH_SEED_AMOUNT)} ETH`);
    await (await pm.betETH(id, true, { value: ETH_SEED_AMOUNT })).wait();
    await (await pm.betETH(id, false, { value: ETH_SEED_AMOUNT })).wait();
  }

  console.log("\n--- TSLA markets ---");
  for (const id of TSLA_MARKET_IDS) {
    const m = await pm.getMarket(id);
    if (Number(m.outcome) !== 0) { console.log(`Market ${id}: resolved, skip`); continue; }
    if (m.yesPool + m.noPool >= TSLA_VOLUME_THRESHOLD) { console.log(`Market ${id}: already has volume, skip`); continue; }
    console.log(`Market ${id}: seeding both sides with ${formatUnits(TSLA_SEED_AMOUNT, 18)} TSLA`);
    await (await pm.bet(id, true, TSLA_SEED_AMOUNT)).wait();
    await (await pm.bet(id, false, TSLA_SEED_AMOUNT)).wait();
  }

  console.log("\n--- Combos ---");
  const comboCount = await combo.nextComboId();
  for (let id = 0; id < Number(comboCount); id++) {
    const c = await combo.getCombo(id);
    if (Number(c.outcome) !== 0) { console.log(`Combo ${id}: resolved, skip`); continue; }
    if (c.noPool > 0n && c.yesPool > 0n) { console.log(`Combo ${id}: already has both sides, skip`); continue; }
    const isEth = c.collateralToken.toLowerCase() === ETH_SENTINEL.toLowerCase();
    const seedMisses = c.noPool === 0n;
    console.log(`Combo ${id}: seeding ${seedMisses ? "MISSES" : "HITS"} side`);
    if (isEth) {
      await (await combo.betComboETH(id, !seedMisses, { value: ETH_SEED_AMOUNT })).wait();
    } else {
      await (await combo.betCombo(id, !seedMisses, COMBO_TSLA_SEED_AMOUNT)).wait();
    }
  }

  console.log("\nDone. Treasury ETH:", formatEther(await ethers.provider.getBalance(signer.address)));
  console.log("Treasury TSLA:", formatUnits(await tsla.balanceOf(signer.address), 18));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
