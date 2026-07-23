# TODO / Next Steps

Status: unaudited, live on Robinhood Chain **Testnet** (chain ID `46630`) with governance migrated to a Safe multisig, and `@rwaforge/sdk` [published on npm](https://www.npmjs.com/package/@rwaforge/sdk). Not on mainnet yet.

---

## v1 / v2 — Ship this (core product)

**What it is**: Users claim tokenized stocks/RWAs distributed by protocols they use. They browse live prediction markets on the Predict tab and trade directly in the dashboard via Polymarket embed. Protocols (Sairi, Atelier, Bankr) use `DistributionRouter` + SDK to push tokenized stock rewards to their holders and users.

### Blocking for mainnet

- [ ] **Security audits complete.** 6 contracts submitted to [onedollaraudit.com](https://www.onedollaraudit.com) — awaiting reports. Do not deploy with real value until all clear. Contracts in scope: `ForgeToken`, `TeamVesting`, `DistributionRouter`, `Treasury`, `RewardClaimer`, `PredictVault`.
- [ ] **Finalize $FORGE tokenomics.** Placeholder 15/30/25/30 split in `contracts/scripts/deploy.ts` — decide real allocation before mainnet.
- [ ] **Mainnet Safe multisig.** Deploy a 2-of-3+ Safe on RH Chain mainnet (chain ID `4663`). Use `contracts/scripts/migrate-governance.ts` to transfer all ownership/roles off the deployer key.

### Done

- [x] All 5 core contracts deployed and tested on RH Chain Testnet
- [x] Governance migrated to 2-of-2 Safe on testnet
- [x] `@rwaforge/sdk` published on npm, verified against clean install
- [x] Dashboard live at [rwaforge.vercel.app](https://rwaforge.vercel.app)
- [x] Merkle CLI — `sdk/scripts/generate-merkle.ts` generates root + proofs from CSV
- [x] Polymarket prediction markets embedded in dashboard (Predict tab)
- [x] Finance-relevant market filtering (stocks, rates, crypto, earnings)
- [x] Inline trade embed — click Trade inside the app, no redirect to Polymarket

### Still needed before mainnet

- [ ] **Gas benchmarking.** `MAX_BATCH_SIZE = 500` is a guess — profile on RH Chain mainnet before setting it in stone.
- [ ] **Confirm stock token transfer semantics.** `DistributionRouter` assumes standard ERC-20 (amount in = amount received). Verify Robinhood Chain tokenized stocks aren't fee-on-transfer or rebasing.
- [ ] **Real `IRWASwapRouter` adapter.** `Treasury.executeSwap` only has `MockSwapRouter` in tests. Wire up whatever DEX/aggregator exists on RH Chain mainnet.
- [ ] **Partner outreach.** Contact Sairi, Atelier, Bankr — send them `@rwaforge/sdk` + `DistributionRouter` address. This is the B2B distribution angle: they push tokenized stock rewards to their users via one SDK call.

---

## v3 / v4 — Expand with fee revenue (do not build until v1/v2 generates income)

**What it adds**: Full cross-chain collateral flow. Users lock tokenized stocks in `PredictVault` on RH Chain → operator agent bridges USDC to Polygon → places Polymarket CLOB order → on win, bridges USDC back → swaps to stock token → settles to user. Requires an operator USDC float (~$5–10k) and LayerZero bridge setup.

- [ ] **Deploy `PredictVault.sol`** — contract written and compiled, audit submitted. Hold deployment until v3.
- [ ] **Operator agent** — `agent/` directory is fully written (`src/index.ts`, `rhChain.ts`, `bridge.ts`, `polymarketClob.ts`, `polygonSwap.ts`). Requires: LZ endpoint address for RH Chain mainnet, USDC OFT addresses on both chains, Polymarket CLOB API key, operator USDC float on Polygon.
- [ ] **LayerZero USDC OFT deployment** — deploy OFT adapter for USDC on RH Chain mainnet, wire to Polygon OFT.
- [ ] **RH Chain DEX swap** — wire USDC → stock token swap on whatever DEX lives on RH Chain mainnet (Uniswap V3 fork assumed).
- [ ] **Kalshi integration** — US-regulated prediction market, requires API key + account. Add as opt-in.

---

## Nice to have (either phase)

- [ ] **Foundry fuzz/invariant tests** — `contracts/foundry.toml` is configured but no Foundry test suite exists yet.
- [ ] **`@rwaforge/sdk/react` hooks** — `useDistribute`, `useClaim` wagmi hooks for faster dashboard integrations.
- [ ] **CI** — GitHub Actions for compile/test/typecheck on PRs.
- [ ] **Block explorer verification** — fill in `RH_TESTNET_EXPLORER_API_URL` in `hardhat.config.ts` and run `hardhat verify` against testnet deployment.

---

## Explicitly out of scope (by design)

- No custody of user funds — `RewardClaimer.claimFor` and agent patterns are relayer flows, funds always go to the intended recipient.
- No production staking/DAO governor — left for a follow-up module. Current ownership is transferable `Ownable`/`AccessControl`.
