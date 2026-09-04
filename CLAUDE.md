# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` at the repo root is a symlink to this file so Codex and other agents read the same guidance. Edit this file only. Keep the **Current state** section at the bottom true; update it whenever something lands or changes, with the date.

## What this repo is

**Thesis.fun** for the Thetanuts hackathon: a social trading feed in the shape of pump.fun and fomo, where each post ("callout") is a thesis backed by a real options position on Thetanuts, filled from the creator's own wallet on **Base mainnet**. Others take the Bull side (same structure) or the Bear side (opposite) with their own budget. Every position and result is verifiable onchain; losing theses cannot be deleted.

Owner decisions (all 2026-09-05):
- **Every market Thetanuts has liquidity for.** Derive assets, strikes, expiries live from OptionBook orders. Never hardcode an asset list.
- Base mainnet only (chainId 8453).
- **Social trading app like fomo.** Icon rail, creator ticker, callout feed with the position card nested inside each post, trending rail, trader popups, follow and share.
- **Creators get paid** a share of the fills their callout brings in, like X pays creators. The rate is the owner's: `TODO-OWNER`.
- **AI is a companion, never a trade step.** An "Explain this thesis" action like Grok on X. AI never builds, sizes, or executes positions. Teammate owns it.
- **No Privy.** Wallet address is the identity (wagmi + viem, include Coinbase Smart Wallet). Add email/social login only if the owner asks.
- Product numbers are the owner's: budget presets, trending and ending-soon rules, leaderboard formula, creator payout rate, fees, slippage, gas headroom. Tag them `TODO-OWNER` in code and UI. Never invent a value.

Team: owner + Claude on UI and Thetanuts logic. Teammate on the AI companion.

## Design direction (decided 2026-09-05)

- **Spec is the mockup**: `docs/mockups/thesis-fun-mockup.html`. Its `:root` tokens, fonts, layout and charts are the source of truth. Reference material (fomo demo video, pump.fun screenshots) lives in gitignored `.demo/`.
- **Stadium, dark, gold.** Near-black ground `#0e0e11`, surfaces `#15151a` / `#1c1c22`, hairlines `#26262e`. Accent gold `#F5C542` with dark text on filled elements. Gain text `#5ee39a`, loss text `#ff7a8a`; saturated fills `#22c55e` / `#f43f5e` only for chips, chart pins and selected side. Rejected: fomo purple, pump.fun mint `#44F4AB`, orange-and-serif, light "tote board".
- **Fonts**: Bricolage Grotesque (display 800), Archivo (UI), JetBrains Mono (all numbers, `tabular-nums`).
- **Color rules** (from pump.fun, fomo, Stocktwits, Mercury, Kraken, Robinhood): color is for numbers only; labels, names and bars stay neutral. One thin single-color Bull split bar with a neutral remainder, never green-versus-red bars. Bull and Bear buttons are neutral at rest and colored on hover or selection. Gold only on Create, live chips, active tab, sign buttons, and a small dot before creator earnings. Small mono meta text at 12px, not 11px.
- Design changes go through a mockup first (pixels before prose), then code.

## Thetanuts integration

- SDK: `@thetanuts-finance/thetanuts-client@0.3.0` (ethers v6 + viem), installed in `packages/thetanuts`. Docs: https://docs.thetanuts.finance/sdk (append `.md` to a page URL; full export at `/llms-full.txt`).
- **Read `docs/thetanuts-sdk-research.md` before touching the SDK.** It is a 999-line research report written by a codex sol and verified by Claude against the SDK bytes (14 load-bearing citations re-read). Its prompt is beside it.
- Verified facts that shape the code:
  - `encodeFillOrder` and `encodeApprove` return `{to, data}` calldata; wagmi/viem send them. No ethers signer needed for the app.
  - `client.api.fetchOrders()` returns every live maker order; assets come from `buildPriceFeedSymbolMap(8453)` (eight feeds configured: ETH, BTC, SOL, DOGE, XRP, BNB, PAXG, AVAX).
  - In a browser the client constructor throws unless `keyStorageProvider` is passed; use `MemoryStorageProvider`. RFQ is never used.
  - The budget passed to preview/fill is the taker's **premium spend** in collateral base units, not contracts. Contracts are capped at the maker's remaining size. Recompute premium as `numContracts * pricePerContract / 1e8`; never trust `preview.totalCollateral`.
  - Preview returns no max loss or max payout. Settlement is automatic on r12; `client.option.payout()` throws.
  - Do not use: `filterOrders` (drops `rawApiData`), `client.events.getOrderFillEvents` (stale event layout), `mmPricing` beyond ETH/BTC, `swapAndFillOrder`, RFQ, MCP.
- **UNVERIFIED until tested with small real money** (see the report's open questions): contract-size decimals per collateral; what the taker pays when the maker is the buyer (our Bear side, gated behind a flag in code); capped-budget rounding; settlement timing and indexer P&L accounting. Code that touches these says so in its doc comment.
- `@thetanuts-finance/mcp` was audited clean but is for AI chat clients; the owner ruled it out for the app.

## Build order (owner-approved 2026-09-05, revised the same day)

Owner's order: **UI first, then Thetanuts core logic, then DB and socials.** Concretely:
1. **Core trade logic** in `packages/thetanuts` (framework-agnostic): read client, market universe from live orders, quote with recomputed premium, approve + fill calldata for viem, receipt parsing, position readers, payoff math. Offline tests.
2. **UI on typed mock data** in `apps/web` from the mockup: `/`, `/t/[slug]`, `/u/[handle]`, `/portfolio`, `/new`. No DB, no wallet library yet.
3. **Wire UI to logic + wallet** (wagmi + viem, Coinbase Smart Wallet). Real fills with tiny size on mainnet to settle the UNVERIFIED list.
4. **Foundation + socials**: Drizzle schema (users, theses, positions, follows, comments, activity), sign-in with wallet, follow, comment, activity, leaderboard, trending, creator payouts.
5. **Polish and ship**: Open Graph share cards, verified badges, Vercel.

Parallel track (teammate): AI companion, once the thesis data shape from step 2/4 is agreed.

## How work is done here (owner rules, verbatim where it matters)

- **"NEVER TRUST YOURSELF, DON'T FUCKED UP."** Every claim, number, name and file path is verified at the source before it is used or said. A sol's output and Claude's own output are invalid until re-measured. Load the `verify-first` skill before claims and the `fable-method` skill before hard tasks.
- **Writer and reviewers are different agents.** Code is written by a codex sol (`codex exec -s workspace-write -m gpt-5.6-sol -c model_reasoning_effort="low"`) or an Opus worker from a pinned brief carrying the no-product-decisions block. Review is two legs: Claude (hands-on, adversarial, not the author) and a codex sol at high reasoning with a digest-pinned diff and a mandatory `Reviewed <path> SHA-256 <digest>` opener. Fold until both are GREEN. Briefs and transcripts live in gitignored `.research/`.
- Parallel writers get separate git worktrees. Never two agents in one mutable tree.
- **Bun only.** Never npm, npx, yarn, pnpm. Registry lookups via `bun pm view`. shadcn via `bunx shadcn@latest add <name> -c packages/ui`.
- Never push without an explicit owner command. Never `--no-verify`. Local commits are fine.
- The repo will be public: no credential-shaped values in tracked files. `apps/web/.env` is the only env file and is gitignored; it holds the local `DATABASE_URL` and the production Supabase password (project ref still needed to form the prod URL).

## Commands

Package manager is **bun** (`packageManager` pin in root `package.json`). Turborepo drives tasks; `-F <pkg>` filters.

```bash
bun install                 # workspace install (run from repo root)
bun run dev                 # all apps; web is http://localhost:3001
bun run dev:web             # web only
bun run build               # turbo build
bun run check-types         # tsc --noEmit across packages
cd packages/thetanuts && bun test          # offline unit tests for the trade logic
cd packages/thetanuts && bunx tsc --noEmit

# Database (Drizzle + Postgres, run from root)
bun run db:push | db:generate | db:migrate | db:studio

# Local Postgres via Supabase CLI (Docker), config in packages/db/supabase/
# Only the db (and its kong gateway) are enabled; auth, storage, studio, realtime,
# inbucket, edge runtime and analytics are switched off in config.toml on purpose.
cd packages/db && supabase start     # DB on postgresql://postgres:postgres@127.0.0.1:54322/postgres
cd packages/db && supabase status
cd packages/db && supabase stop

# The turbo db:* wrappers are marked interactive and fail without a TTY (agents, CI).
cd packages/db && bunx drizzle-kit push

# Vercel
bun run deploy:setup        # vercel link (once)
bun run env:preview | env:production   # push apps/web/.env to Vercel
bun run deploy | deploy:prod | deploy:check
```

No lint setup yet; `turbo.json` declares a `lint` task nobody implements.

## Architecture

Turborepo monorepo, all TypeScript, ESM. Workspaces: `apps/*` and `packages/*`. Shared dependency versions live in the root `package.json` `catalog` and are referenced as `"catalog:"`.

```
apps/web             Next.js 16 app (App Router, React 19, React Compiler on, typedRoutes on)
packages/thetanuts   @nuts/thetanuts: framework-agnostic trade logic on the Thetanuts SDK (+ bun tests)
packages/db          Drizzle ORM + node-postgres. Schema in src/schema, migrations in src/migrations
packages/env         Validated env via t3-env. `@nuts/env/server` (DATABASE_URL, NODE_ENV) and `@nuts/env/web`
packages/ui          Shared shadcn/ui components on @base-ui/react + Tailwind v4. Exports globals.css, components/*, lib/*, hooks/*
packages/config      Shared tsconfig.base.json (strict, noUncheckedIndexedAccess, noUnused*)
docs/                Tracked knowledge: SDK research report, UI mockup
scripts/             sync-vercel-env.ts (used by env:preview / env:production)
.research/, .demo/   Gitignored: sol briefs and transcripts, reference videos and screenshots
```

How the pieces connect:
- **One env file**: `apps/web/.env` (gitignored). `drizzle.config.ts` points at it explicitly. `packages/env/src/server.ts` loads `.env` from the **current working directory** via dotenv, so `@nuts/db` finds it when Next runs from `apps/web` but not when a script runs from `packages/db`. For scripts there, use `bun --env-file=../../apps/web/.env run <file>`.
- **DB access**: import `db` from `@nuts/db`. It is created eagerly from `env.DATABASE_URL`, so importing `@nuts/db` in a client component will fail. Keep it in server components, route handlers, and server actions.
- **Env validation** runs at import time. `next.config.ts` imports `@nuts/env/web` so bad client env fails the build. `SKIP_ENV_VALIDATION=1` bypasses server validation.
- **Bun installs into an isolated store**: packages resolve through `node_modules/.bun/<name>@<version>/node_modules/...` and per-package `node_modules` symlinks, not a flat root `node_modules/<name>`.
- **UI imports**: `import { Button } from "@nuts/ui/components/button"`. The web app's `index.css` imports `@nuts/ui/globals.css`; design tokens live in `packages/ui/src/styles/globals.css`.
- **Path aliases** in `apps/web`: `@/*` → `apps/web/src/*`, `@nuts/ui/*` → `packages/ui/src/*`.
- **Providers**: `apps/web/src/components/providers.tsx` wraps the app in next-themes and the sonner `Toaster`. Wallet and query providers belong there when added.
- **Vercel**: `vercel.json` deploys `apps/web` as the single `web` service with a root-level `bun install`.

## Next.js version warning

`apps/web/AGENTS.md` is auto-generated by `next dev` and says this Next.js 16 differs from training data. Before writing Next.js code, read the relevant guide under `apps/web/node_modules/next/dist/docs/`. Do not delete that file; `next dev` re-creates it.

## Current state (keep this true; last updated 2026-09-05 03:45 +08)

- Scaffold, local Postgres-only Supabase, docs, mockup, and the empty `packages/thetanuts` package are committed on `main`. Pushed through commit `692e8b2`; later commits are local only until the owner says push.
- **In flight**: a codex sol (low reasoning) is writing `packages/thetanuts` from `.research/thetanuts/brief-core-logic.md`; an Opus worker in worktree `.claude/worktrees/agent-*` is building the five UI routes in `apps/web` from the mockup. Neither is reviewed yet. Review template: `.research/thetanuts/brief-core-review-template.md`.
- Not started: wallet connect, DB schema, socials, AI companion, Vercel.
- Open owner items: production Supabase project ref; every `TODO-OWNER` value listed above.
