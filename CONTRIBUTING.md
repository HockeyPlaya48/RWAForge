# Contributing to RWAForge

RWAForge is MIT-licensed and built to be forked, extended, and integrated by other teams — treat this as an invitation, not a formality.

## Ways to contribute

- **Integrate it.** Point your dApp or agent at the [live testnet deployment](README.md#deployed-contracts-testnet) and try `DistributionRouter`/`RewardClaimer` for real. Friction you hit is exactly what this phase is for — [open an issue](../../issues/new).
- **Fork a module.** Every contract takes its dependencies (treasury address, swap router, reward token) as constructor/parameter arguments rather than hardcoding them, so you can swap in your own vesting shape, a different swap router adapter, or an alternate fee model without touching the rest of the stack. See [`contracts/contracts/`](contracts/contracts).
- **Report a bug.** Especially in the contracts — this code is unaudited (see [TODO.md](TODO.md)), so early, adversarial review is valuable. If it looks like a security issue rather than a routine bug, say so explicitly in the report and avoid posting exploit details publicly until it's triaged.
- **Improve the SDK/docs.** The [TypeScript SDK](sdk) and [agent examples](agent-examples) are thin by design — PRs that add coverage (a wagmi hooks package, a Merkle-tree generation CLI, more runnable examples) are welcome.

## Development setup

```bash
git clone https://github.com/HockeyPlaya48/RWAForge.git
cd RWAForge
npm install

npm run contracts:compile
npm run contracts:test
```

See [DEPLOYMENT.md](DEPLOYMENT.md) if you want to deploy your own instance to Robinhood Chain Testnet.

## Making a change

1. Fork the repo and create a branch off `main`.
2. Keep changes scoped — a bug fix doesn't need an accompanying refactor, a new feature doesn't need to touch unrelated modules.
3. Add or update tests for anything in `contracts/` — `npm run contracts:test` must pass before a PR is reviewed.
4. Match the existing NatSpec style (`@notice`/`@dev`/`@param`/`@return`) on any new or changed Solidity function.
5. Open a PR against `main` with a clear description of *why*, not just *what* — link an issue if there is one.

## Ground rules

- No breaking changes to deployed contract interfaces without a clear migration note — other teams may already be integrated against the testnet addresses.
- Don't add speculative abstractions "for future flexibility" — this codebase favors a few similar lines over a premature framework. See the module-per-job structure already in place.
- Security-sensitive changes (anything touching `DistributionRouter`, `Treasury`, or `RewardClaimer`'s fund-moving paths) get held to a higher bar of scrutiny and test coverage than docs/tooling changes.

## Questions

Open a [Discussion](../../discussions) for design questions or integration help; use [Issues](../../issues) for concrete bugs or feature requests.
