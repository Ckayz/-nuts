# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` at the repo root is a symlink to this file so Codex and other agents read the same guidance. Edit this file only. Keep the **Current state** section at the bottom true; update it whenever something lands or changes, with the date.

## Product source of truth

`docs/PRD.md` is the source of truth for product scope, user journeys, team ownership, shared interfaces, safety rules, and acceptance criteria. This file remains the source of truth for repository conventions and implementation guidance. If the two conflict on product behavior, follow the PRD.

## What this repo is

**Thesis.fun** for the Thetanuts hackathon: a social trading feed in the shape of pump.fun and fomo, where each post ("callout") is a thesis backed by a real options position on Thetanuts, filled from the creator's own wallet on **Base mainnet**. Others take the Bull side (same structure) or the Bear side (opposite) with their own budget. Every position and result is verifiable onchain; losing theses cannot be deleted.

Owner decisions (all 2026-09-05):
- **Every market Thetanuts has liquidity for.** Derive assets, strikes, expiries live from OptionBook orders. Never hardcode an asset list.
- Base mainnet only (chainId 8453).
- **Social trading app like fomo.** Icon rail, creator ticker, callout feed with the position card nested inside each post, trending rail, trader popups, follow and share.
- **Creators get paid** a share of the fills their callout brings in, like X pays creators. The rate is the owner's: `TODO-OWNER`.
- **AI track (owner ruling 2026-09-05, superseding the companion-only decision):** the teammate's approval-gated trading agent stays as built ("keep how they made their ai stuff also. is fine"); `docs/PRD.md` v2.0 stands for the AI track, including its §10.2 safety limits. **Rewire their code onto ours wherever possible** (`packages/thetanuts` for orders, quotes and fill calldata; `packages/db` for thesis context). AI never signs; the wallet approves every transaction.
- **No Privy.** Wallet address is the identity (wagmi + viem, include Coinbase Smart Wallet). Add email/social login only if the owner asks. **Connecting a wallet creates the user profile** (owner 2026-09-05): create-or-fetch the `users` row keyed by the lowercase address, idempotent; build step 4.
- Product numbers are the owner's: budget presets, trending and ending-soon rules, leaderboard formula, creator payout rate, fees, slippage, gas headroom. Tag them `TODO-OWNER` in code and UI. Never invent a value.

Team: owner + Claude on UI and Thetanuts logic. Teammate on the AI track.

Scope conflict of 2026-09-05 (teammate's PRD v2.0 vs companion-only) resolved by the owner the same day: the AI track as built stands (bullet above). The shared `ThesisAiContext` contract (PRD v2.0 §10.3) is field-identical to v1.0 §10.2; `packages/db` implements it exactly.

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
- **Teammate-measured on Base mainnet 2026-09-05 (`docs/HANDOVER.md` §5; NOT re-verified by Claude):** maker signatures expire in 59–113 s and are re-signed about every 60 s, so approve collateral first, then re-fetch and build calldata within ~30 s; the SDK WebSocket host does not resolve (poll 20–30 s); `availableAmount` is the maker's collateral budget, not contracts; the book carries binaries (e.g. "ETH 2460 Up 1D"); tradeable set is USDC-collateral orders with `isLong: false` (~200 of 367); position read-back after a fill needs `api.triggerIndexerUpdate()` and polling; the seven `PHYSICAL_*` multi-leg implementations are not deployed on Base; RFQ has had no offers since 2026-08-20. Treat each as a hypothesis until our own tiny fills confirm it.

## Build order (owner-approved 2026-09-05, revised the same day)

Owner's order: **UI first, then Thetanuts core logic, then DB and socials.** Concretely:
1. **Core trade logic** in `packages/thetanuts` (framework-agnostic): read client, market universe from live orders, quote with recomputed premium, approve + fill calldata for viem, receipt parsing, position readers, payoff math. Offline tests.
2. **UI on typed mock data** in `apps/web` from the mockup: `/`, `/t/[slug]`, `/u/[handle]`, `/portfolio`, `/new`. No DB, no wallet library yet.
3. **Wire UI to logic + wallet** (wagmi + viem, Coinbase Smart Wallet). Real fills with tiny size on mainnet to settle the UNVERIFIED list.
4. **Foundation + socials**: Drizzle schema (users, theses, positions, follows, comments, activity), sign-in with wallet, follow, comment, activity, leaderboard, trending, creator payouts.
5. **Polish and ship**: Open Graph share cards, verified badges, Vercel.

Parallel track (teammate): AI track per `docs/PRD.md` v2.0 (`/agent` workspace, `apps/web/src/lib/thetanuts/*`, `packages/db/src/schema/agent.ts`, migration `0000_agent_tables`). Scope ruling above.

Shared contract with the teammate: `docs/PRD.md` §10.2 defines `ThesisAiContext`; the core side (us) builds and validates it and provides a fixture plus server function. Neither side changes it without telling the other and updating the PRD (PRD §15).

## How work is done here (owner rules, verbatim where it matters)

- **"NEVER TRUST YOURSELF, DON'T FUCKED UP."** Every claim, number, name and file path is verified at the source before it is used or said. A sol's output and Claude's own output are invalid until re-measured. Load the `verify-first` skill before claims and the `fable-method` skill before hard tasks.
- **Zero confidence in everyone, including yourself** (owner, verbatim: "none of yall should trust yourselves or the other. zero confidence in everyone's responses and findings"). Every brief carries this clause; every claim in a report is pasted measurement or it is not a claim; the orchestrator re-measures every headline number and every finding before folding or relaying it.
- **Writer and reviewers are different agents.** Owner rule 2026-09-05 ("all towards gpt astra low effort and we review that"; earlier "don't use opus to work things not related to ui"): **every code change is written by codex `gpt-6-astra` at low reasoning** (`codex exec -s workspace-write -m gpt-6-astra -c model_reasoning_effort="low"`; Astra needs codex CLI ≥ 0.153, a Homebrew cask, `brew upgrade --cask codex`) from a pinned brief carrying the no-product-decisions block; **no Opus workers for writing**. Review is two legs: Claude (hands-on, adversarial, not the author) and codex `gpt-6-astra` at high reasoning with a digest-pinned diff and a mandatory `Reviewed <path> SHA-256 <digest>` opener. Fold until both are GREEN. The codex sandbox has no network and no database and cannot write a worktree's git lock (it lives under the main repo's `.git`), so writers leave the tree uncommitted; Claude verifies, runs live tests and builds, and commits. Briefs and transcripts live in gitignored `.research/`.
- Parallel writers get separate git worktrees. Never two agents in one mutable tree.
- **Bun only.** Never npm, npx, yarn, pnpm. Registry lookups via `bun pm view`. shadcn via `bunx shadcn@latest add <name> -c packages/ui`.
- Never push without an explicit owner command. Never `--no-verify`. Local commits are fine.
- **Pull from GitHub whenever the team has pushed** (owner rule 2026-09-05): `git fetch origin` at the start of every work block and before every commit or worker launch; merge `origin/main` if it is ahead; re-read changed guidance (`CLAUDE.md`, `docs/PRD.md`) before acting; pin worker base commits to hashes on the merged main.
- The repo will be public: no credential-shaped values in tracked files. Env files: `apps/web/.env.local` (real values, gitignored) overrides `apps/web/.env` (gitignored; Claude's local `DATABASE_URL`, the production Supabase URL and password); `apps/web/.env.example` is the only env file in git and never holds a real value. `packages/env/src/server.ts` now also requires `OPENROUTER_API_KEY` (teammate's agent); local runs need a placeholder value in `.env`.
- Teammate's rule (their CLAUDE.md, 2026-09-05): they push validated checkpoints to feature branches under a standing approval they record from the owner; that approval is not approval to merge to main. Claude's own push rule above is unchanged.

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
bun run db:push             # LOCAL THROWAWAY DATABASES ONLY - see warning below
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
# Run drizzle-kit directly instead. No --env-file needed: see Env loading below.
cd packages/db && bunx drizzle-kit generate --name <change>   # write the migration
cd packages/db && bunx drizzle-kit migrate                    # apply it

# NEVER run `drizzle-kit push` against the shared Supabase project. push reshapes
# the database to match the schema of whoever runs it, so running it from a tree
# that lacks the other developer's tables can DROP those tables. Migrations are
# additive and reviewable; push is for a local throwaway database only.

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
- **Env files**: `apps/web/.env.local` holds real values and is gitignored; `apps/web/.env.example` is committed and documents every variable. `.env.local` overrides `.env`, matching Next.js precedence, and the real process environment beats both so Vercel and CI are unaffected. Copy to start: `cp apps/web/.env.example apps/web/.env.local`.
- **Env loading**: `@nuts/env/load` resolves the files relative to the repo, not the current working directory, and every entry point imports it. A script run from `packages/db` finds the same values the web app sees, so `bun --env-file=...` is no longer needed. Required today: `DATABASE_URL` and `OPENROUTER_API_KEY`.
- **Two database URLs.** `DATABASE_URL` is Supabase's transaction pooler (port 6543) and is what the app uses: Vercel functions open many short-lived connections and would exhaust a direct connection. `DIRECT_DATABASE_URL` is the direct connection (port 5432), used only by drizzle-kit because schema changes cannot run through the pooler. On a local database one string does both jobs and `DIRECT_DATABASE_URL` stays empty.
- **DB access**: import `db` from `@nuts/db`. It is created eagerly from `env.DATABASE_URL`, so importing `@nuts/db` in a client component will fail. Keep it in server components, route handlers, and server actions.
- **Env validation** runs at import time. `next.config.ts` imports `@nuts/env/web` so bad client env fails the build. `SKIP_ENV_VALIDATION=1` bypasses server validation.
- **Bun installs into an isolated store**: packages resolve through `node_modules/.bun/<name>@<version>/node_modules/...` and per-package `node_modules` symlinks, not a flat root `node_modules/<name>`.
- **UI imports**: `import { Button } from "@nuts/ui/components/button"`. The web app's `index.css` imports `@nuts/ui/globals.css`; design tokens live in `packages/ui/src/styles/globals.css`.
- **Path aliases** in `apps/web`: `@/*` → `apps/web/src/*`, `@nuts/ui/*` → `packages/ui/src/*`.
- **Providers**: `apps/web/src/components/providers.tsx` wraps the app in next-themes and the sonner `Toaster`. Wallet and query providers belong there when added.
- **Vercel**: `vercel.json` deploys `apps/web` as the single `web` service with a root-level `bun install`.

## Next.js version warning

`apps/web/AGENTS.md` is auto-generated by `next dev` and says this Next.js 16 differs from training data. Before writing Next.js code, read the relevant guide under `apps/web/node_modules/next/dist/docs/`. Do not delete that file; `next dev` re-creates it.

## Current state (keep this true; last updated 2026-09-05 09:42 +0800)

- `main` at the merge of the teammate's AI track (`origin/main` `c30a4e2`, merged mechanically) plus the DB migration-chain rebase; local-ahead of `origin/main`. Push is authorized by the owner ONLY once the DB work's two-leg review is GREEN; everything else waits for an explicit push command. Fetch origin at the start of every work block (owner: "rmb to pull my team's changes").
- Machine crash 2026-09-05 ~05:34 killed two Astra runs mid-flight; both relaunched fresh (never resumed). Docker/OrbStack must be started by hand after a reboot (`open -a OrbStack`).
- **Core trade logic** `packages/thetanuts`: **GREEN from both review legs at `e8b0b06`** (history in `.research/thetanuts/review-r*-claude.md`, `sol-core-review-r*.final.md`). Still UNVERIFIED on mainnet until tiny real fills: contract-size decimals, Bear-side taker debit (gated), capped-budget rounding, settlement timing, plus the teammate's signature-expiry finding above.
- **DB** `packages/db`: round 3 content at `0366f35` (creator-identity and wallet fences, Base-only and structural checks, snapshot immutability, 113 split integration tests). Astra high review r3 **RED** (`astra-db-review-r3.out`): MAJOR 1 trigger reads take no row locks (publish vs position-status/wallet change can interleave; fix `FOR SHARE` + two-connection tests); MAJOR 2 old `0005` did not scan pre-existing rows (MOOT after the rebase below); MINOR README overstates wallet fencing for draft/pending/cancelled links. All re-measured TRUE by Claude (`review-db-r2-claude.md`, round-3 section). **Migration chain rebased** (`a8e543c`, Opus worker, re-measured by Claude): `0000_agent_tables` (teammate's, byte-identical, already applied to production), `0001_core_schema` (generated), `0002_core_triggers` (hand-written functions/triggers). Reason: drizzle applies only entries newer than the last applied row (`pg-core/dialect.js` ~line 62), so our older chain would have been skipped on production. Proof: live catalog dump before/after byte-identical (`.research/thetanuts/db-catalog-{before,after}-rebase.txt`, SHA `5d8a17b0…`). Round 4 writer (Astra low) queued behind the rewire slot: `brief-db-fold-r4.md` → `astra-db-fold-r4.out` in worktree `.claude/worktrees/db-r4` (branch `db-r4` from `6e4ad21`); `FOR SHARE` locks in `0002_core_triggers` + two-connection tests + README. Claude applies and runs live afterwards.
- **UI** branch `ui-r1` at `4dd56de` (worktree `.claude/worktrees/ui-r1`): review r1 **RED** from both legs (`astra-ui-review-r1.out`, `review-ui-r1-claude.md`): MAJOR types do not match the shared contract (no `direction`, numbers instead of decimal strings, non-PRD names); MAJOR profile inline grid defeats the mobile breakpoint; minors (zero sentinels in mock data, tab ARIA, icon-button names); mockup break-even `76120` inconsistent with its own curve (zero at `77287`). Round 2 folded and committed by Claude at `bc3fcd3` (domain/display split via `apps/web/src/lib/{display,display-types,view-data,format}.ts`, profile breakpoint class, tab/radio ARIA + keyboard, null sentinels, break-even `77,287` in mockup and port; mockup SHA now `b18337cc…`). Verified by Claude: check-types, `next build` 16 pages, forbidden-pattern scan clean, 11 `TODO-OWNER`. Astra high review r2 running (`brief-ui-review-r2.md`, diff `review-ui-r2.diff` SHA `1add874b…`, 3732 lines) → `astra-ui-review-r2.out`; Claude leg in `review-ui-r2-claude.md`. Not merged. When merging, `apps/web/src/components/providers.tsx` conflicts with the teammate's wagmi providers; keep theirs and add ours around them.
- **Rewire (owner order 2026-09-05)**: replace the teammate's `apps/web/src/lib/thetanuts/*` (raw HTTP order feed, own sizing) with `@nuts/thetanuts` (`createReadClient`, `fetchLiveOrders`, `deriveMarkets`, `quoteFill`, later `buildFillTransactions`), and replace the `getThesisContext` stub in `apps/web/src/lib/agent/tools.ts` with a server function over `@nuts/db` (`buildThesisAiContextOrUnavailable`). Keep their agent, scope gate, chat route, `/agent` page, wagmi config and env loader. Writer (Astra low) running: `brief-rewire-r1.md` → `astra-rewire-r1.out` in worktree `.claude/worktrees/rewire` (branch `rewire` from `6e4ad21`).
- Env: `apps/web/.env` (Claude's, gitignored) now also carries a placeholder `OPENROUTER_API_KEY` because the teammate's server env requires it; real key only for the agent. Production Supabase: project ref `xentgcambhxdsenfnntj`; direct host is IPv6-only from this machine (DNS fails); the pooler URL is not in the repo. Production migration only by `bunx drizzle-kit migrate` after GREEN and a reachability check; never `push`.
- Open owner items: every `TODO-OWNER`; UI items above (`ThesisStatus` naming, `/new` copy, single detail fixture, connected user unnamed); gap G1 (AI context for draft/pending theses returns `not_published`).
- Incident 2026-09-05 ~04:20: a UI worker's `pkill -f "turbo run dev -F web"` killed the owner's unrelated dev server in `~/Developer/fission-labs/naise-ai` (port 3001).
