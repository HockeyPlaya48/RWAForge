# RWAForge ($FORGE)

**Agent-Powered RWA Rewards Infrastructure**

RWAForge is a modular, MIT-licensed protocol for distributing tokenized real-world assets (RWAs) and stock tokens as rewards — built for Robinhood Chain and designed from day one to be driven by autonomous agents as easily as by humans.

> Forge Real Value Onchain. Distribute Tokenized Stocks. Powered by Agents.

---

## Why RWAForge

Robinhood Chain brings tokenized equities and RWAs onchain. What's missing is the distribution layer: a standard, composable way for protocols, DAOs, and agents to move those assets to users at scale — as airdrops, staking rewards, referral payouts, or loyalty programs — without every team re-inventing batch-transfer and claim logic.

RWAForge is that layer. It is:

- **Universal** — works with any ERC-20, including Robinhood Chain stock tokens and other RWAs.
- **Agent-native** — every entry point is a plain function call with no assumptions about `msg.sender` being an EOA. Built for ERC-4337 smart accounts, session keys, and sponsored gas.
- **Fee-sustaining** — a small, governance-adjustable protocol fee funds a treasury that buys RWAs and recycles value back to $FORGE holders and stakers.
- **Modular** — each contract does one job and can be forked, replaced, or extended independently.

---

## Why Agent-Native?

Most crypto infrastructure quietly assumes a human is on the other end of every transaction — someone clicking "confirm" in a wallet, holding ETH for gas, remembering to check back for rewards. RWAForge doesn't make that assumption anywhere in the stack. Every contract, every SDK call, and every example in this repo is built so an autonomous agent can do the entire job by itself — start to finish, gas and all — exactly as well as a human can.

### What "agent-native" actually means

In plain terms: nothing in RWAForge cares *who* or *what* is calling it, as long as the call is valid. `DistributionRouter` and `RewardClaimer` never check "is this a real person's wallet?" — they just execute the logic. That one design choice is what lets an AI agent running a task queue, a keeper bot, or a smart contract belonging to another protocol interact with RWAForge exactly like a person would, with no special-casing, no bridge contract, and no permission it wouldn't also grant a human.

### The technical building blocks

| Feature | What it does | Where it shows up |
|---|---|---|
| **ERC-4337 account abstraction** | Lets an agent operate through a smart contract wallet instead of a private-key-holding EOA — the standard way onchain agents hold and spend funds. | [`agent-examples/erc4337-agent-distribution.ts`](agent-examples/erc4337-agent-distribution.ts) submits a full `UserOperation` against `DistributionRouter`. |
| **Session keys** | An agent can be scoped to a key that *only* works for calling `DistributionRouter`/`RewardClaimer` — so a compromised or misbehaving agent can't touch anything else, even if it holds the key 24/7. | Recommended in [`agent-examples/README.md`](agent-examples/README.md); enforced at the smart-account layer, not by RWAForge itself. |
| **Gas sponsorship (paymasters)** | An agent that only ever holds $FORGE or a stock token — no ETH — can still transact, because a paymaster covers gas. Nothing in RWAForge assumes the caller pre-funded gas. | Wired into the same agent example via `createPaymasterClient`. |
| **Batch operations** | One call fans out to many recipients atomically — either the whole batch lands or none of it does. | `DistributionRouter.distribute()` handles up to 500 recipients per call; the agent example batches `approve` + `distribute` into a *single* `UserOperation`. |
| **Relayed claims (`claimFor`)** | Claiming a reward doesn't require the recipient to have gas, sign anything, or even be online — a relayer submits the proof, funds still land only in the recipient's wallet. | `RewardClaimer.claimFor(index, account, amount, proof)` — the caller and the recipient can be two different addresses. |
| **Wallet-agnostic SDK** | The TypeScript SDK is built on plain viem calls with no assumptions about wallet type — the exact same `forge.distribution.distribute()` call works whether it's signed by a browser wallet or executed inside an agent's UserOperation. | [`sdk/src/distribution.ts`](sdk/src/distribution.ts), [`sdk/src/claims.ts`](sdk/src/claims.ts) |

### What this unlocks, for each type of user

**For platforms like Atelier (agent orchestration/task platforms)**
An agent can own the entire reward loop — detect that a task finished, a referral converted, or a staking epoch closed, and immediately distribute or claim the payout — with no human in the approval path and no custody of user funds along the way. Scope its session key to RWAForge's two contracts and the blast radius of a bug or a bad decision stays contained to "can distribute tokens correctly," never "can drain anything."

**For end users of RWAForge**
Rewards show up without friction. You don't need ETH sitting in your wallet to claim a stock-token airdrop — an agent or relayer can submit the claim for you via `claimFor`, and the tokens land in your wallet regardless of who paid the gas. No manual multi-step claim flow, no "top up your wallet first" dead end.

**For $FORGE holders**
More agents building on RWAForge means more distributions flowing through `DistributionRouter`, which means more protocol fee revenue into the `Treasury`, which means more RWAs bought and pushed out through `RewardClaimer` as claimable rounds. Agent adoption isn't just a UX nicety here — it's the flywheel the token's revenue loop is built on: **agent activity → protocol fees → RWA buybacks → holder/staker airdrops.**

---

## Brand

| | |
|---|---|
| Name / ticker | RWAForge / **$FORGE** |
| Tagline | "Agent-Powered RWA Rewards Infrastructure" (primary) — also: "Forge Real Value Onchain," "Distribute Tokenized Stocks. Powered by Agents." |
| Style | Clean, modern fintech with a subtle AI/tech edge — minimalist and trustworthy, somewhere between Chainlink and a modern Robinhood UI. |
| Tone | Professional yet innovative — serious infrastructure that stays approachable for agent developers and RWA projects. |

**Color palette**

| Role | Color | Hex |
|---|---|---|
| Primary (trust / finance) | Deep navy | `#0F172A` (alt: `#0A2540`) |
| Accent (growth / real value) | Vibrant teal/mint | `#14B8A6` (alt: `#00D4AA`) |
| Neutrals | Clean whites/grays | `#F1F5F9`, `#94A3B8` |

**Logo concept**: a stylized "R" or abstract "forge" mark that merges an agent/robot silhouette with an upward stock-chart line — or a simple geometric forge hammer striking a glowing RWA token.

**Visual language**: subtle grid/blockchain patterns, clean charts of RWA flows, agent icons interacting with stock tokens. Dark mode is the primary surface for the dApp experience — see [`dashboard/`](dashboard) for the reference implementation of this palette.

---

## Architecture

```
                         ┌─────────────────────┐
                         │      ForgeToken      │  ERC-20, fixed supply cap, pausable
                         │        ($FORGE)      │
                         └──────────┬───────────┘
                                    │ vests to team via
                                    ▼
                         ┌─────────────────────┐
                         │     TeamVesting      │  1yr cliff / 3yr linear
                         └─────────────────────┘

  Agent / dApp / User
         │
         │ distribute(token, recipients[], amounts[])
         ▼
┌─────────────────────┐     protocol fee      ┌─────────────────────┐
│  DistributionRouter   │ ─────────────────────▶│       Treasury        │
│  batch sends, fee     │                        │  fee collection,      │
│  logic, ERC-4337 safe │                        │  RWA swaps, holdings  │
└─────────────────────┘                        └──────────┬───────────┘
                                                            │ funds
                                                            ▼
                                                 ┌─────────────────────┐
                                                 │    RewardClaimer      │
                                                 │  Merkle claims,        │
                                                 │  agent-relayed claims  │
                                                 └─────────────────────┘
```

| Contract | Purpose |
|---|---|
| [`ForgeToken.sol`](contracts/contracts/ForgeToken.sol) | $FORGE ERC-20. Hard-capped supply, owner-mintable up to that cap, pausable, permit (EIP-2612) for gasless approvals. |
| [`TeamVesting.sol`](contracts/contracts/TeamVesting.sol) | Linear vesting with a cliff for a team allocation. |
| [`DistributionRouter.sol`](contracts/contracts/DistributionRouter.sol) | Permissionless batch-distribution entry point for any ERC-20. Deducts a configurable protocol fee (1–5%, default 3%) and routes it to the Treasury. |
| [`Treasury.sol`](contracts/contracts/Treasury.sol) | Collects protocol fees, swaps them into RWAs through a pluggable swap router, and tracks the resulting portfolio for downstream distribution. |
| [`RewardClaimer.sol`](contracts/contracts/RewardClaimer.sol) | Merkle-root based claim contract for airdrops and revenue-share distributions. Supports `claim` and `claimFor` so agents/relayers can pay gas on behalf of recipients. |

All contracts are built on [OpenZeppelin Contracts v5](https://docs.openzeppelin.com/contracts/5.x/), use `SafeERC20` for token transfers, `ReentrancyGuard` where funds move, and custom errors instead of `require` strings for gas efficiency and clarity. See inline NatSpec in each contract for full parameter and behavior documentation.

---

## Repository layout

```
RWAForge/
├── contracts/          Hardhat + Foundry-compatible Solidity workspace
│   ├── contracts/      Core protocol contracts
│   ├── scripts/        Deployment scripts (mainnet + testnet)
│   └── test/           Hardhat/Mocha test suite
├── sdk/                TypeScript SDK (viem + wagmi) for distributions & claims
├── dashboard/           Next.js example dApp (connect, distribute, claim)
├── agent-examples/     ERC-4337 agent integration example
├── DEPLOYMENT.md       Step-by-step testnet deployment guide
├── TODO.md             Remaining work before mainnet / production use
└── README.md
```

---

## Robinhood Chain

| | |
|---|---|
| Mainnet Chain ID | `4663` |
| Testnet Chain ID | `46630` |
| Gas token | ETH |
| Account abstraction | ERC-4337 (native smart account support) |
| Example RPC (mainnet) | `https://rpc.mainnet.chain.robinhood.com` |
| Example RPC (testnet) | `https://rpc.testnet.chain.robinhood.com` |
| Alchemy | supported — swap in your Alchemy endpoint for either network |

Chain definitions for both networks live in [`contracts/hardhat.config.ts`](contracts/hardhat.config.ts) (Hardhat) and [`sdk/src/config.ts`](sdk/src/config.ts) (viem `defineChain`), so you only need to configure RPC URLs once per environment.

---

## $FORGE tokenomics — TBD

Final allocation, vesting, and fair-launch mechanics have **not** been decided yet and are intentionally left out of this README so nothing here is mistaken for a commitment. What's already built and tested, mechanism-first:

- **Supply cap**: `ForgeToken.MAX_SUPPLY` hard-caps total supply; the owner can mint up to that cap and never beyond it, regardless of who holds ownership later.
- **Vesting**: `TeamVesting.sol` implements a generic cliff + linear-vest escrow (deploy one instance per beneficiary/schedule) — the cliff and duration are constructor parameters, not hardcoded.
- **Fee bounds**: `DistributionRouter`'s protocol fee is hard-bounded onchain to 1–5% (default 3%), so whatever the final number is, governance can tune it within that range but never exceed it.
- **Revenue loop**: fees collected by `DistributionRouter` → `Treasury` → swapped into supported RWAs via a pluggable `IRWASwapRouter` → pushed to `RewardClaimer` as a new Merkle round for holders/stakers.

When allocation percentages, staking mechanics, and launch structure are finalized, they'll be documented here and wired into [`contracts/scripts/deploy.ts`](contracts/scripts/deploy.ts). See [TODO.md](TODO.md) for status.

---

## Quickstart

```bash
git clone <your-fork-url> rwaforge && cd rwaforge
npm install

# Compile & test contracts
npm run contracts:compile
npm run contracts:test

# Configure environment
cp contracts/.env.example contracts/.env
cp sdk/.env.example sdk/.env.local 2>/dev/null || true
cp dashboard/.env.example dashboard/.env.local
```

For a full walkthrough of deploying to Robinhood Chain testnet (chain ID `46630`), see **[DEPLOYMENT.md](DEPLOYMENT.md)**. The short version:

```bash
cp contracts/.env.example contracts/.env   # fill in PRIVATE_KEY, TREASURY_OWNER, etc.
npm run contracts:deploy:testnet           # runs scripts/deploy.ts against robinhoodTestnet
```

This deploys `ForgeToken` → `TeamVesting` → `Treasury` → `DistributionRouter` → `RewardClaimer` in order, wires their addresses together, and writes the result to `contracts/deployments/robinhoodTestnet.json`. Mainnet uses the same script against `robinhoodMainnet`.

Foundry users: `forge build` and `forge test` work directly against `contracts/contracts` using the same OpenZeppelin remappings (see [`contracts/foundry.toml`](contracts/foundry.toml)) — Hardhat remains the source of truth for deployment scripts.

---

## Integration guide

### For dApps / protocols (TypeScript SDK)

```bash
npm install @rwaforge/sdk viem
```

```ts
import { createRwaForgeClient, robinhoodChainTestnet } from "@rwaforge/sdk";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const wallet = createWalletClient({
  account: privateKeyToAccount(process.env.DISTRIBUTOR_PRIVATE_KEY as `0x${string}`),
  chain: robinhoodChainTestnet,
  transport: http(process.env.RH_RPC_URL),
});

const forge = createRwaForgeClient({
  wallet,
  chain: robinhoodChainTestnet,
  addresses: {
    distributionRouter: "0xYourDistributionRouterAddress",
    rewardClaimer: "0xYourRewardClaimerAddress",
  },
});

// Distribute a stock token to a batch of recipients — handles the
// approve-for-(amount+fee) step automatically.
await forge.distribution!.approveAndDistribute({
  token: "0xStockTokenAddress",
  recipients: ["0xUser1", "0xUser2"],
  amounts: [100_000000n, 250_000000n], // token's native decimals
});

// Claim a Merkle-based reward for a user (e.g. relayed by an agent, or an
// operations bot paying gas on behalf of someone who has none).
await forge.claims!.claimFor({
  index: 42n,
  account: "0xUser1",
  amount: 5_000000n,
  proof: ["0x...", "0x..."],
});
```

Full runnable versions of both flows: [`sdk/examples/distribute.ts`](sdk/examples/distribute.ts), [`sdk/examples/claim.ts`](sdk/examples/claim.ts).

### For AI agents (ERC-4337)

RWAForge's router and claimer never assume an EOA caller — an ERC-4337 smart account (or a session key scoped to it) can call `distribute` or `claimFor` exactly like a normal wallet, with gas optionally sponsored by a paymaster. [`agent-examples/erc4337-agent-distribution.ts`](agent-examples/erc4337-agent-distribution.ts) builds and submits a single `UserOperation` that batches `approve` + `distribute`:

```ts
const userOpHash = await bundlerClient.sendUserOperation({
  calls: [
    { to: stockTokenAddress, abi: erc20Abi, functionName: "approve", args: [routerAddress, total + fee] },
    { to: routerAddress, abi: distributionRouterAbi, functionName: "distribute", args: [stockTokenAddress, recipients, amounts] },
  ],
});
```

Both calls succeed or fail together, so the agent's payout is atomic. See [`agent-examples/README.md`](agent-examples/README.md) for setup (bundler/paymaster endpoints, session-key scoping recommendations).

### For the dashboard

```bash
cd dashboard
npm install
cp .env.example .env.local   # fill in deployed contract addresses
npm run dev
```

A minimal Next.js app (wagmi + viem, dark navy/mint theme) that connects a wallet, lets an operator create a batch distribution, and lets a user claim a Merkle reward. See [`dashboard/app/page.tsx`](dashboard/app/page.tsx) and [`dashboard/lib/wagmi.ts`](dashboard/lib/wagmi.ts) for wiring.

### For other teams forking this protocol

Every contract does one job and takes its dependencies (treasury address, swap router, reward token) as constructor/parameter arguments rather than hardcoding them — so you can swap in your own vesting shape, a different swap router adapter, or an alternate fee model without touching the rest of the stack. Start from [`contracts/contracts/`](contracts/contracts) and [`contracts/scripts/deploy.ts`](contracts/scripts/deploy.ts).

---

## Security notes

- All value-moving external calls use `SafeERC20` and follow checks-effects-interactions; state-mutating public functions that move funds are `nonReentrant`.
- `DistributionRouter` fee parameters are hard-bounded in the contract (1–5%) — governance cannot configure a fee outside that range, even after ownership is transferred to a DAO.
- `RewardClaimer` tracks claimed indices per epoch to prevent double-claims and is agnostic to who submits the claim transaction (`claim` vs `claimFor`), so relayers/agents never need custody of user funds.
- This code has **not been audited**. Do not deploy to mainnet with real value without an independent security review — see [TODO.md](TODO.md) for the full list of pre-mainnet work.

## Contributing

RWAForge is intentionally forkable. Open a PR, fork the repo for your own integration (Clawbank, Sairi, or any other agent/RWA project), or extend a module (new swap router, new vesting shape, alternate fee model) — the contracts are split so you can swap one piece without touching the rest.

## License

MIT — see [LICENSE](LICENSE).
