# Thesis.fun

Thesis.fun is a social trading app for the Thetanuts hackathon on Base mainnet. A thesis is a text post that may name an options structure or link a position; trades exist independently, with their own shareable position pages. Wallet addresses are identities, and the wallet approves every transaction, including trades prepared by the AI agent.

```sh
bun install
bun run dev
bun run verify
```

See the [deployment runbook](docs/DEPLOY.md) for environment setup and verification, and the [PRD](docs/PRD.md) for product scope.

This repository will be public: never commit secrets or credential-shaped values. Only `apps/web/.env.example` belongs in git; real env files stay gitignored.
