# Audit Scope

## One Dollar Audit Submission

**Service**: [onedollaraudit.com](https://www.onedollaraudit.com) — AI smart-contract audits, escrowed & delivered on-chain. Cost: 1 USDC (also accepts ETH and $CLAWD). Run by [@austingriffith](https://x.com/austingriffith).

**How to submit**: Go to [onedollaraudit.com](https://www.onedollaraudit.com), pay 1 USDC, and paste the contracts or GitHub link into their intake form. The audit runs through their AI pipeline and is delivered on-chain.

**What to include in the submission:**
- GitHub repo: `https://github.com/HockeyPlaya48/RWAForge`
- In-scope: `ForgeToken`, `TeamVesting`, `DistributionRouter`, `Treasury`, `RewardClaimer` (see table below)
- Out of scope: `contracts/contracts/mocks/`
- Solidity `^0.8.24`, OZ v5, no proxies, optimizer 200 runs, `viaIR: true`, `evmVersion: "cancun"`
- 100% statement/line/function coverage across all in-scope contracts; 82% branch (gaps are internal OZ branches)
- Slither already run — 7 findings, all triaged (see "Static analysis" section below)

**Key areas to focus on:**
- `DistributionRouter.distribute` is intentionally permissionless — verify this cannot be abused as a drain vector
- `RewardClaimer.claimFor` — verify funds always reach `account`, never `msg.sender`, under all input combinations
- `Treasury.executeSwap` — state write after external call (`rwaHoldings` update), mitigated by `nonReentrant`; verify reasoning holds
- Fee bounds (`MIN_FEE_BPS`/`MAX_FEE_BPS`) as `constant`s — verify governance truly cannot exceed 1–5% after ownership transfer

---


Prepared for an independent security review. This document exists so a reviewer's first hours go toward finding real issues, not reverse-engineering intent — every non-obvious design decision below was made deliberately, not overlooked.

## Status

Unaudited. Live on Robinhood Chain **Testnet** only (chain ID `46630`) — see [Deployed Contracts](README.md#deployed-contracts-testnet). Not deployed to mainnet. No real value has moved through these contracts; all testnet activity is free-faucet ETH and a token with no market value.

## In scope

| Contract | Path | Purpose |
|---|---|---|
| `ForgeToken` | `contracts/contracts/ForgeToken.sol` | ERC-20, hard-capped supply, pausable, EIP-2612 permit |
| `TeamVesting` | `contracts/contracts/TeamVesting.sol` | Single-beneficiary cliff + linear vesting escrow |
| `DistributionRouter` | `contracts/contracts/DistributionRouter.sol` | Permissionless batch ERC-20 distribution, bounded protocol fee |
| `Treasury` | `contracts/contracts/Treasury.sol` | Role-gated fee collection, RWA swap execution, holdings tracking |
| `RewardClaimer` | `contracts/contracts/RewardClaimer.sol` | Merkle-based claim contract, self-service or relayed |
| `IRWASwapRouter` | `contracts/contracts/interfaces/IRWASwapRouter.sol` | Interface only — no logic to review |

**Out of scope**: `contracts/contracts/mocks/` (`MockERC20`, `MockSwapRouter`) — test-only fixtures, never deployed outside the local test suite.

## Dependencies

- Solidity `^0.8.24`, compiled with `evmVersion: "cancun"`, optimizer on (200 runs), `viaIR: true`.
- OpenZeppelin Contracts `^5.0.2` (installed: `5.6.1` — uses `MCOPY`, hence the Cancun target. If Robinhood Chain's EVM doesn't support Cancun opcodes at the audit/deploy target, this needs to be revisited alongside the OZ version pin).
- No upgradeable proxies — all contracts are deployed as immutable implementations.

## Threat model / design decisions worth knowing upfront

- **`DistributionRouter.distribute` is intentionally permissionless.** Any caller can distribute any ERC-20 they hold/approved to any recipient list. This is the point, not an access-control gap — it's meant to work identically for a human, a protocol, or an ERC-4337 agent, with no allowlist.
- **`RewardClaimer.claimFor` lets any relayer submit a claim on behalf of `account`, but funds always transfer to `account`, never to `msg.sender`.** This is the agent-relay design (gas sponsorship for users with no ETH) — verify it cannot be used to redirect funds under any input combination.
- **Fee bounds are hardcoded, not just default values**: `DistributionRouter.MIN_FEE_BPS = 100` / `MAX_FEE_BPS = 500` are `constant`s checked in `setFeeBps`. Governance (even after transfer to a DAO) cannot set a fee outside 1–5%.
- **`TeamVesting.release()` is deliberately callable by anyone** (not just the beneficiary) — funds only ever move to the immutable `beneficiary` address, so permissionless triggering just lets automation/keepers release on schedule without holding the beneficiary's key.
- **`Treasury` uses role separation**: `GOVERNANCE_ROLE` (fee-token support list, withdrawals) vs `OPERATOR_ROLE` (executing pre-approved swaps). Intent: a keeper/agent can hold `OPERATOR_ROLE` and run swaps without ever being able to withdraw funds.
- **`Treasury.executeSwap` writes `rwaHoldings[tokenOut] += amountOut` after the external call to `router.swapExactIn`**, not before — flagged by Slither as `reentrancy-benign`. This ordering is unavoidable (the output amount is only known after the swap executes) and is mitigated by `nonReentrant`. Please verify this reasoning holds rather than taking it on faith.
- **`ForgeToken.MAX_SUPPLY` is a hard cap enforced in `mint`**, making "owner-mintable" and "fixed total supply" compatible: minting only refills unissued supply, never exceeds the cap.
- **Governance is on a Safe multisig on testnet** (2-of-2, rehearsal threshold — verified via `contracts/scripts/migrate-governance.ts`, which transferred all `Ownable`/`AccessControl` authority off the deployer EOA). Mainnet will use a higher threshold (2-of-3+); the same script handles that migration.

## Static analysis (Slither) — already triaged

Ran against all in-scope contracts (`slither . --compile-force-framework hardhat --filter-paths mocks`), 100 detectors, 7 results. All reviewed, none required a behavioral fix:

| Finding | File | Disposition |
|---|---|---|
| `incorrect-equality` — `amount == 0` | `TeamVesting.release()` | Standard "nothing to do" guard on a deterministically-computed `uint256`; not attacker-influenced in a way that matters. |
| `uninitialized-local` — `total` | `DistributionRouter.distribute()` | Solidity zero-initializes value types; fixed anyway (`uint256 total = 0;`) for clarity at zero cost. |
| `reentrancy-benign` — state write after external call | `Treasury.executeSwap()` | See threat-model note above; mitigated by `nonReentrant`, ordering is structurally required. |
| `timestamp` (×2) — vesting comparisons | `TeamVesting.release()` / `_vestedAmount()` | Miner timestamp manipulation (~15s) is immaterial against a 1-year cliff / 3-year vest. Standard pattern (same as OZ's own `VestingWallet`). |
| `unindexed-event-address` — `Paused`/`Unpaused` | OpenZeppelin's `Pausable.sol` | Third-party dependency code, not in our control or scope. |

No AI-only screen (e.g. a $1/onedollaraudit.com-style pass) has been substituted for a full manual review — if one is run, treat it as an additional cheap first pass, not a replacement for this document's purpose.

## Test suite

36 Hardhat/Mocha tests across all in-scope contracts (`npm run contracts:test`, or `npx hardhat coverage` from `contracts/` for a full report). Every in-scope contract is at **100% statement/line/function coverage**; overall branch coverage is 82% (remaining gaps are internal OpenZeppelin branches — e.g. `ERC20Pausable`'s own checks — not this repo's logic). Covers access control, fee bounds, batch validation, pause/unpause, Merkle claim/double-claim/relay/sweep behavior, role-gated Treasury operations including both branches of `withdraw`'s holdings bookkeeping, and the full `TeamVesting` cliff/linear-vest/multi-release schedule (previously untested — see below).

See [TODO.md](TODO.md) for known gaps beyond unit coverage (gas benchmarking at scale, fee-on-transfer token behavior, a real `IRWASwapRouter` adapter has never been deployed — only a test mock exists).

## What's deliberately not built yet (don't go looking for it)

- No staking contract, no yield/reward-accrual mechanism for holding `$FORGE`.
- No real `IRWASwapRouter` implementation — `Treasury.executeSwap` has never been exercised against a live DEX/aggregator, only `MockSwapRouter` in tests.
- No finalized tokenomics/allocation — the split in `contracts/scripts/deploy.ts` is a placeholder.
- No governor/DAO contract — ownership is transferable `Ownable`/`AccessControl`, nothing more.

See [TODO.md](TODO.md) for the full list and [README.md](README.md) for architecture/branding context.
