# RWAForge agent examples

RWAForge's contracts never assume `msg.sender` is an EOA. That means an
ERC-4337 smart account — the standard way an autonomous agent holds and
spends funds onchain — can call `DistributionRouter.distribute` or
`RewardClaimer.claimFor` exactly like any other wallet, with gas optionally
sponsored by a paymaster so the agent never needs to hold ETH.

## [`erc4337-agent-distribution.ts`](erc4337-agent-distribution.ts)

Builds and submits a single sponsored `UserOperation` that:

1. Approves `DistributionRouter` for `sum(amounts) + protocol fee`.
2. Calls `distribute(token, recipients, amounts)`.

Both calls are batched into one UserOperation so the payout is atomic from
the agent's point of view — either both succeed or neither does.

### Setup

```bash
cd agent-examples
npm install
cp ../contracts/.env.example .env   # reuse as a starting point, then edit:
```

Required environment variables:

| Variable | Description |
|---|---|
| `AGENT_PRIVATE_KEY` | Key controlling the agent's smart account (ideally a scoped session key, not the agent's root key) |
| `RH_RPC_URL` | Robinhood Chain RPC endpoint |
| `BUNDLER_URL` | ERC-4337 bundler endpoint for Robinhood Chain |
| `PAYMASTER_URL` | Optional — paymaster endpoint for sponsored gas |
| `DISTRIBUTION_ROUTER_ADDRESS` | Deployed `DistributionRouter` address |
| `STOCK_TOKEN_ADDRESS` | RWA/stock token the agent is distributing |

```bash
npm run distribute
```

## Extending this pattern

- **Claims**: the same approach applies to `RewardClaimer.claimFor` — an
  agent can relay claims for users who have no gas of their own, without
  ever taking custody of their funds (the contract always pays out to the
  `account` argument, never the caller).
- **Session keys**: scope the smart account's session key to only allow
  calls to `DistributionRouter` and `RewardClaimer`, so a compromised agent
  key can't move funds anywhere else.
