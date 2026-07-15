# TODO / Next Steps

Status: unaudited foundation, compiles clean, 20/20 tests passing, no live deployment yet. This tracks what stands between here and a real launch.

## Before any mainnet deployment (blocking)

- [ ] **Independent security audit.** Nothing in `contracts/` has been reviewed by anyone but the person who wrote it. This is the single biggest gap — do not deploy with real value before one.
- [ ] **Finalize $FORGE tokenomics.** README intentionally omits allocation percentages/fair-launch mechanics for now. `contracts/scripts/deploy.ts` currently mints a placeholder 15/30/25/30 split (team/community/liquidity/treasury) purely to demonstrate the mechanism — revisit before it's treated as real.
- [ ] **Real Robinhood Chain endpoints.** RPC URLs, block explorer API, and ERC-4337 bundler/paymaster URLs throughout the repo (`hardhat.config.ts`, `sdk/src/config.ts`, `agent-examples/`) are best-guess placeholders based on the brief. Confirm the actual production endpoints before deploying anywhere real.
- [ ] **Confirm Cancun/MCOPY support.** `hardhat.config.ts` targets `evmVersion: "cancun"` because OpenZeppelin Contracts 5.6+ uses the `MCOPY` opcode. Verify Robinhood Chain's EVM implementation actually supports Cancun opcodes before mainnet deploy — if not, pin `@openzeppelin/contracts` to `<5.6` and drop `evmVersion` to `"shanghai"`/`"paris"`.
- [ ] **Multisig for governance roles.** `TREASURY_OWNER` should be a real multisig (Safe or equivalent) on mainnet, not a single EOA — the deploy script and docs assume you'll swap this in.

## Should do before wider use

- [ ] **Gas benchmarking on `DistributionRouter.distribute`.** It does `recipients.length + 1` separate `transferFrom` calls (no internal pooling), which is simple and safe but not the cheapest possible design at large batch sizes. `MAX_BATCH_SIZE = 500` is a guess, not a measured gas-limit-safe number for Robinhood Chain specifically — profile and adjust.
- [ ] **Decide the real swap router adapter.** `IRWASwapRouter` is a deliberately minimal interface; `Treasury.executeSwap` currently has nothing production-grade behind it (only `MockSwapRouter` for tests). Needs a real adapter for whatever DEX/aggregator exists on Robinhood Chain.
- [ ] **Staking contract.** Referenced in the original product brief ("staking for boosted claims/revenue share") but not built — no staking contract exists yet in this repo.
- [ ] **Governance contract.** Ownership/roles are currently plain `Ownable`/`AccessControl`, transferable to a DAO governor later but no governor contract is included.
- [ ] **Fee-on-transfer / rebasing token handling.** `DistributionRouter` and `Treasury` assume standard ERC-20 transfer semantics (amount sent == amount received). Confirm Robinhood Chain stock tokens/RWAs behave this way, or add balance-delta accounting if not.
- [ ] **Merkle tree generation tooling.** `sdk/src/merkle.ts` exposes the leaf-hashing function, but there's no CLI/script yet to take a CSV of `(account, amount)` pairs and produce a root + per-user proofs for `RewardClaimer.updateMerkleRoot`. Needed before running a real claim round.

## Nice to have

- [ ] **Foundry test suite.** `contracts/foundry.toml` is configured so `forge build`/`forge test` work against the same contracts, but only the Hardhat/Mocha suite has actual tests. Add a `test-foundry/` suite if the team prefers Foundry-style fuzz/invariant testing.
- [ ] **wagmi hooks package.** `sdk/` is a plain viem-based SDK; a thin `@rwaforge/sdk/react` layer with `useDistribute`/`useClaim` hooks would make dashboard-style integrations faster to build.
- [ ] **CI.** No GitHub Actions workflow yet for `npm run contracts:compile` / `contracts:test` / SDK typecheck on PRs.
- [ ] **Real dependency audit.** `npm install` currently surfaces ~40-65 `npm audit` warnings, mostly from the wagmi/WalletConnect dependency tree in `dashboard/`. Not investigated — worth a pass before shipping the dashboard publicly.
- [ ] **Block explorer verification config.** `hardhat.config.ts` has `etherscan.customChains` entries wired up but empty (`RH_EXPLORER_API_URL`, etc.) — fill in once a Robinhood Chain explorer instance is confirmed.

## Explicitly out of scope for this repo (by design)

- No production staking/governance token vote-counting logic — left for a follow-up module so this stays a distribution-layer primitive, not a full DAO stack.
- No custody of user funds anywhere — `RewardClaimer.claimFor` and the agent examples are relayer patterns, not custodial ones. Keep it that way.
