# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` at the repo root is a symlink to this file so Codex and other agents read the same guidance. Edit this file only.

## What this repo is

**Thesis.fun** for the Thetanuts hackathon: a pump.fun / FOMO-style social feed where each "launch" is a real options position on Thetanuts, executed on **Base mainnet**. Users post a thesis, take a bull or bear side with their own budget via a real Thetanuts OptionBook fill, and everyone's P&L is verifiable onchain.

Scope decisions from the owner (2026-09-05):
- **Every market Thetanuts offers**, not a fixed asset list. Read available assets, strikes and expiries live from OptionBook; never hardcode BTC/ETH.
- Base mainnet only.
- **No AI in the loop.** The creator picks the option structure from what OptionBook has liquidity for. Do not add an LLM step.
- Product numbers (risk defaults, fees, trending rules, leaderboard formulas) are the owner's. Ask, never invent.

Thetanuts integration:
- Use `@thetanuts-finance/thetanuts-client` directly (OptionBook: browse orders, `previewFillOrder`, `fillOrder`). Not yet installed.
- Do not use `@thetanuts-finance/mcp`; it is for AI chat clients and the owner ruled it out. The SDK and docs were audited on 2026-09-05 and are clean.
- Docs: https://docs.thetanuts.finance/sdk (append `.md` to a page URL for markdown; full export at https://docs.thetanuts.finance/llms-full.txt).

## Build order (owner-approved 2026-09-05)

1. **Foundation.** Local Postgres up. Drizzle schema for users, theses, positions, follows, comments, activity. Wallet connect on Base (wagmi + viem + a connector kit, include Coinbase Smart Wallet). Sign a message to prove the address. Wallet address is the identity; **no Privy** unless the owner asks for email/social login later.
2. **UI on mock data.** Feed (new, trending, ending soon, settled), create thesis, thesis page with bull/bear side, profile, portfolio, share card. Build against agreed types so it runs in parallel with step 3.
3. **Thetanuts read.** Live OptionBook orders. Derive assets, strikes, expiries from what has liquidity. Show price and preview a fill for a budget. Feed and create flow switch from mock to real here.
4. **Thetanuts write.** Approve collateral, fill from the user's wallet, store tx hash and position. Read settlement, compute live and settled P&L. Riskiest step; test with small size on mainnet.
5. **Socials.** Follow, comment, join a side, activity log, leaderboard, trending. Needs steps 1 and 4.
6. **Polish and ship.** Open Graph share images, verified badges from onchain history, Vercel deploy.

Parallel work: steps 2 and 3 side by side once step 1 types are agreed. Step 5 can start on the DB/UI side while step 4 is being tested.

Technical note for step 4: the SDK is built on ethers while wagmi uses viem. The SDK's "Encode for External Wallets" path returns raw calldata, so fills can be sent through viem without an ethers adapter. Confirm against the docs before relying on it.

## Commands

Package manager is **bun** (`packageManager` pin in root `package.json`). Turborepo drives tasks; `-F <pkg>` filters.

```bash
bun install                 # workspace install (run from repo root)
bun run dev                 # all apps; web is http://localhost:3001
bun run dev:web             # web only
bun run build               # turbo build
bun run check-types         # tsc --noEmit across packages (the only "test" today)

# Database (Drizzle + Postgres, run from root)
bun run db:push             # push schema to DATABASE_URL (dev)
bun run db:generate         # write SQL migrations to packages/db/src/migrations
bun run db:migrate          # apply migrations
bun run db:studio           # Drizzle Studio

# Local Postgres via Supabase CLI (Docker), config in packages/db/supabase/
# Only the db (and its kong gateway) are enabled; auth, storage, studio, realtime,
# inbucket, edge runtime and analytics are switched off in config.toml on purpose.
cd packages/db && supabase start     # DB on postgresql://postgres:postgres@127.0.0.1:54322/postgres
cd packages/db && supabase status
cd packages/db && supabase stop

# The turbo db:* wrappers are marked interactive and fail without a TTY (agents, CI).
# Run drizzle-kit directly instead:
cd packages/db && bunx drizzle-kit push

# Vercel
bun run deploy:setup        # vercel link (once)
bun run env:preview | env:production   # push apps/web/.env to Vercel
bun run deploy | deploy:prod | deploy:check
```

There is no lint or unit-test setup yet. `turbo.json` declares a `lint` task but no package implements it.

## Architecture

Turborepo monorepo, all TypeScript, ESM. Workspaces: `apps/*` and `packages/*`. Shared dependency versions live in the root `package.json` `catalog` and are referenced as `"catalog:"`.

```
apps/web          Next.js 16 app (App Router, React 19, React Compiler on, typedRoutes on)
packages/db       Drizzle ORM + node-postgres. Schema in src/schema, migrations in src/migrations
packages/env      Validated env via t3-env. `@nuts/env/server` (DATABASE_URL, NODE_ENV) and `@nuts/env/web` (client vars, empty today)
packages/ui       Shared shadcn/ui components on @base-ui/react + Tailwind v4. Exports globals.css, components/*, lib/*, hooks/*
packages/config   Shared tsconfig.base.json (strict, noUncheckedIndexedAccess, noUnused*)
scripts/          sync-vercel-env.ts (used by env:preview / env:production)
```

How the pieces connect:
- **One env file**: `apps/web/.env` (gitignored). Set `DATABASE_URL` there; local Supabase value is `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. `drizzle.config.ts` points at that file explicitly. `packages/env/src/server.ts` loads `.env` from the **current working directory** via dotenv, so `@nuts/db` finds it when Next runs from `apps/web` but not when a script runs from `packages/db`. For scripts there, use `bun --env-file=../../apps/web/.env run <file>`.
- **DB access**: import `db` from `@nuts/db`. It is created eagerly from `env.DATABASE_URL`, so importing `@nuts/db` in a client component will fail. Keep it in server components, route handlers, and server actions.
- **Env validation** runs at import time. `next.config.ts` imports `@nuts/env/web` so bad client env fails the build. Set `SKIP_ENV_VALIDATION=1` to bypass server validation.
- **UI imports**: `import { Button } from "@nuts/ui/components/button"`. The web app's `index.css` just imports `@nuts/ui/globals.css`; design tokens live in `packages/ui/src/styles/globals.css`. Add shared primitives with `npx shadcn@latest add <name> -c packages/ui` from the root; app-specific blocks go through the shadcn CLI run inside `apps/web`.
- **Path aliases** in `apps/web`: `@/*` → `apps/web/src/*`, `@nuts/ui/*` → `packages/ui/src/*`.
- **Providers**: `apps/web/src/components/providers.tsx` wraps the app in next-themes and the sonner `Toaster`. Wallet and query providers belong there when added.
- **Vercel**: `vercel.json` deploys `apps/web` as the single `web` service with a root-level `bun install`.

## Next.js version warning

`apps/web/AGENTS.md` is auto-generated by `next dev` and says this Next.js 16 differs from training data. Before writing Next.js code, read the relevant guide under `apps/web/node_modules/next/dist/docs/`. Do not delete that file; `next dev` re-creates it.

## Working rules

- Never commit `apps/web/.env`. Never push without an explicit owner instruction.
- The scaffold came from Better-T-Stack; `bts.jsonc` records the exact flags and enables `bunx create-better-t-stack@latest add` for addons.
