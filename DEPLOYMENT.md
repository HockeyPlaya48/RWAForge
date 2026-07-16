# Testnet Deployment Guide (Robinhood Chain, chain ID 46630)

Deploys the full RWAForge protocol — `ForgeToken`, `TeamVesting`, `Treasury`, `DistributionRouter`, `RewardClaimer` — to Robinhood Chain Testnet in one command.

## Prerequisites

- Node.js 18+ and npm.
- A funded testnet deployer wallet (ETH is the gas token on Robinhood Chain).
- A Robinhood Chain Testnet RPC URL (public endpoint or your own Alchemy/provider URL).

## 1. Install dependencies

From the repo root (this installs and links all workspaces — `contracts`, `sdk`, `dashboard`):

```bash
npm install
```

## 2. Configure environment

```bash
cp contracts/.env.example contracts/.env
```

Edit `contracts/.env`:

```bash
PRIVATE_KEY=0xyour_testnet_deployer_key         # never commit this
RH_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com
TREASURY_OWNER=0xyour_testnet_multisig_or_eoa    # owns Treasury/DistributionRouter/RewardClaimer post-deploy
TEAM_VESTING_BENEFICIARY=0xyour_test_beneficiary # receives the TeamVesting allocation
```

For a first testnet run it's fine to set `TREASURY_OWNER` and `TEAM_VESTING_BENEFICIARY` to your deployer address — you can transfer roles later. Use a **dedicated testnet key**, never a key that also holds mainnet funds.

## 3. Fund the deployer

Get testnet ETH into the address matching `PRIVATE_KEY` (from a Robinhood Chain testnet faucet, or bridge from another testnet if one isn't yet available). Deployment of five contracts plus several mint/setup transactions needs enough ETH to cover ~7-8 transactions' worth of gas.

## 4. Compile and test locally first

```bash
npm run contracts:compile
npm run contracts:test
```

All tests should pass before you deploy anywhere. This also catches config/dependency issues without spending testnet gas.

## 5. Deploy

```bash
npm run contracts:deploy:testnet
```

This runs [`contracts/scripts/deploy.ts`](contracts/scripts/deploy.ts) against the `robinhoodTestnet` network (chain ID `46630`, as configured in [`contracts/hardhat.config.ts`](contracts/hardhat.config.ts)). It will:

1. Deploy `ForgeToken`.
2. Deploy `TeamVesting` (1-year cliff, 3-year linear vest, starting at deploy time).
3. Deploy `Treasury`, owned by `TREASURY_OWNER`.
4. Deploy `DistributionRouter`, pointed at the new `Treasury`.
5. Deploy `RewardClaimer` for `ForgeToken`.
6. Mint the token's allocation buckets (see [`deploy.ts`](contracts/scripts/deploy.ts) — the current split is a placeholder pending the tokenomics decisions tracked in [TODO.md](TODO.md)) and transfer `ForgeToken` ownership to `TREASURY_OWNER` if it differs from the deployer.
7. Write all addresses to `contracts/deployments/robinhoodTestnet.json`.

Expect output like:

```
Deploying RWAForge to robinhoodTestnet (chainId 46630)
ForgeToken deployed:        0x...
TeamVesting deployed:       0x...
Treasury deployed:          0x...
DistributionRouter deployed: 0x...
RewardClaimer deployed:      0x...
Deployment record written to contracts/deployments/robinhoodTestnet.json
```

## 6. Wire the addresses into the SDK / dashboard

Copy the addresses from `contracts/deployments/robinhoodTestnet.json` into:

- [`sdk/src/config.ts`](sdk/src/config.ts) — add an entry to the `deployments` map for chain ID `46630`.
- `dashboard/.env.local` (`cp dashboard/.env.example dashboard/.env.local` first) — `NEXT_PUBLIC_DISTRIBUTION_ROUTER_ADDRESS`, `NEXT_PUBLIC_REWARD_CLAIMER_ADDRESS`, `NEXT_PUBLIC_FORGE_TOKEN_ADDRESS`.

## 7. Migrate governance to a multisig

The deploy script sets `TREASURY_OWNER` as owner/admin everywhere, which for a first deploy is usually a single EOA. Before this deployment controls anything of real value, move governance to a [Safe](https://app.safe.global) multisig (confirmed supported on both Robinhood Chain and Robinhood Testnet):

1. Create a Safe at [app.safe.global](https://app.safe.global) on the matching network, with at least 2 owners and a threshold > 1.
2. Run the migration script against your deployment:
   ```bash
   NEW_GOVERNANCE_OWNER=0xYourSafeAddress npx hardhat run scripts/migrate-governance.ts --network robinhoodTestnet
   ```
   This transfers ownership of `ForgeToken`, `TeamVesting`, `DistributionRouter`, and `RewardClaimer`, and moves `Treasury`'s `DEFAULT_ADMIN_ROLE`/`GOVERNANCE_ROLE` to the Safe — then revokes those roles from the original signer. It's idempotent: safe to re-run, it skips anything already migrated.
3. Verify onchain (don't just trust the script's own output) — read `owner()` on each `Ownable` contract and `hasRole()` on `Treasury` to confirm the Safe holds control and the old EOA doesn't.

## 8. Post-deploy setup (as needed)

- **Grant a Treasury operator**: `Treasury.grantRole(OPERATOR_ROLE, keeperOrAgentAddress)` so an automated process can call `executeSwap`.
- **Approve RWA swap targets**: `Treasury.setSupportedRWA(rwaTokenAddress, true)` for each stock/RWA token you want fees swapped into.
- **Publish a claim round**: fund `RewardClaimer` with tokens, then `RewardClaimer.updateMerkleRoot(root)` with a root built via [`sdk/src/merkle.ts`](sdk/src/merkle.ts) (`claimLeaf`) or `merkletreejs`.
- **Sanity-check a distribution**: call `DistributionRouter.distribute` with a tiny amount to a test recipient before running it against real value.

## 9. Verify on a block explorer (optional)

Robinhood Chain Testnet has a live Blockscout explorer at [explorer.testnet.chain.robinhood.com](https://explorer.testnet.chain.robinhood.com/). Set `RH_TESTNET_EXPLORER_API_URL`/`RH_TESTNET_EXPLORER_BROWSER_URL` in `contracts/.env` to that instance's API, then:

```bash
npx hardhat verify --network robinhoodTestnet <contract_address> <constructor_args...>
```

## Mainnet

Once testnet behavior is validated (and ideally after an audit — see [TODO.md](TODO.md)), the same flow applies with `RH_MAINNET_RPC_URL` set and:

```bash
npm run contracts:deploy:mainnet
```

Use a Safe multisig (step 7 above, Safe confirmed supported on Robinhood Chain mainnet too) for `TREASURY_OWNER` on mainnet — never a single EOA.
