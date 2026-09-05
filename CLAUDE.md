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
- **Creator payouts are FUTURE ROADMAP** (owner 2026-09-05: "we'll put creator fees as future roadmap, but we'll do callouts anyways for now. so we just do our own earning first"). Callouts ship; the platform's own referrer share is the only revenue for now. Do not build a creator ledger or payout UI yet; keep the attribution data (fill event, referrer, thesis link) so it can be added later. The rate remains `TODO-OWNER` if and when it comes back.
- **AI track (owner ruling 2026-09-05, superseding the companion-only decision):** the teammate's approval-gated trading agent stays as built ("keep how they made their ai stuff also. is fine"); `docs/PRD.md` v2.0 stands for the AI track, including its §10.2 safety limits. **Rewire their code onto ours wherever possible** (`packages/thetanuts` for orders, quotes and fill calldata; `packages/db` for thesis context). AI never signs; the wallet approves every transaction.
- **No Privy.** Wallet address is the identity (wagmi + viem, include Coinbase Smart Wallet). Add email/social login only if the owner asks. **Connecting a wallet creates the user profile** (owner 2026-09-05): create-or-fetch the `users` row keyed by the lowercase address, idempotent; build step 4.
- **Both sides (owner ruling 2026-09-05, "do both, go")**: the product offers the taker-BUY side (user pays premium in the order's collateral token; bounded loss) AND the taker-SELL side (user receives premium and locks collateral; loss up to the collateral), each clearly labelled with its own sizing and copy. The sell side stays gated in code until a tiny real fill measures the seller's actual debit (research open question 2); the OptionBook contract source is read first to derive the expected debit.
- **Revenue = Thetanuts referrer fees** (docs "Referrer Fees"): every fill carries a `referrer` address (the builder key); protocol fee `min(0.06% notional, 12.5% premium)`; our share `fee × splitBps / 10000` accrues per collateral token in `fees[token][referrer]` and is self-claimed (`claimFees`). **The OptionBook owner must whitelist our address and set the split** (`setReferrerFeeSplit` is owner-only; unwhitelisted referrers earn 0, seen live in fill `0xa2edb8…`, `referralFeePaid: 0`). RFQ referral fees are owner-withdrawn only. Owner action: get one platform address whitelisted. Creator payouts: roadmap only (decision above). **Roadmap line (owner 2026-09-05): "our platform earns through trading fees" = the referrer share of Thetanuts OptionBook fees; requires the whitelist above.** Memo done (Astra medium, citations to docs/SDK lines and tx hashes): `.research/thetanuts/monetisation-memo.md`. Its recommendation: one platform-controlled referrer address, self-claim per token, an auditable creator ledger credited from each fill's actual `referralFeePaid`; no extra platform charge. Owner decisions pending: the referrer wallet (`THESIS_REFERRER`, custody), the split Thetanuts grants, the creator rate.
- Product numbers are the owner's: budget presets, trending and ending-soon rules, leaderboard formula, creator payout rate, fees, slippage, gas headroom. Tag them `TODO-OWNER` in code and UI. Never invent a value.

Team: owner + Claude on UI and Thetanuts logic. Teammate on the AI track.

Scope conflict of 2026-09-05 (teammate's PRD v2.0 vs companion-only) resolved by the owner the same day: the AI track as built stands (bullet above). The shared `ThesisAiContext` contract (PRD v2.0 §10.3) is field-identical to v1.0 §10.2; `packages/db` implements it exactly.

## Design direction (decided 2026-09-05)

- **Spec is the mockup**: `docs/mockups/thesis-fun-mockup.html`. Its `:root` tokens, fonts, layout and charts are the source of truth. Reference material (fomo demo video, pump.fun screenshots) lives in gitignored `.demo/`.
- **Stadium, dark, gold.** Near-black ground `#0e0e11`, surfaces `#15151a` / `#1c1c22`, hairlines `#26262e`. Accent gold `#F5C542` with dark text on filled elements. Gain text `#5ee39a`, loss text `#ff7a8a`; saturated fills `#22c55e` / `#f43f5e` only for chips, chart pins and selected side. Rejected: fomo purple, pump.fun mint `#44F4AB`, orange-and-serif, light "tote board".
- **Fonts**: Bricolage Grotesque (display 800), Archivo (UI), JetBrains Mono (all numbers, `tabular-nums`).
- **Color rules** (from pump.fun, fomo, Stocktwits, Mercury, Kraken, Robinhood): color is for numbers only; labels, names and bars stay neutral. One thin single-color Bull split bar with a neutral remainder, never green-versus-red bars. Bull and Bear buttons are neutral at rest and colored on hover or selection. Gold only where the mockup puts it: the logo, Create and primary/sign buttons, live chips, the active tab, the CREATOR badge, the spot-price guide line and the spot chart's gradient, plus focus outlines. (Corrected 2026-09-05 after review; the creator-earnings dot is gone with the placeholders.) Small mono meta text at 12px, not 11px.
- Design changes go through a mockup first (pixels before prose), then code.

## Thetanuts integration

- SDK: `@thetanuts-finance/thetanuts-client@0.3.0` (ethers v6 + viem), installed in `packages/thetanuts`. Docs: https://docs.thetanuts.finance/sdk (append `.md` to a page URL; full export at `/llms-full.txt`).
- **Read `docs/thetanuts-sdk-research.md` before touching the SDK.** It is a 999-line research report written by a codex sol and verified by Claude against the SDK bytes (14 load-bearing citations re-read). Its prompt is beside it.
- Verified facts that shape the code:
  - `encodeFillOrder` and `encodeApprove` return `{to, data}` calldata; wagmi/viem send them. No ethers signer needed for the app.
  - `client.api.fetchOrders()` returns every live maker order; assets come from `buildPriceFeedSymbolMap(8453)` (eight feeds configured: ETH, BTC, SOL, DOGE, XRP, BNB, PAXG, AVAX).
  - In a browser the client constructor throws unless `keyStorageProvider` is passed; use `MemoryStorageProvider`. RFQ is never used.
  - **Raw `isLong` is the MAKER's side** (SDK `normalizeOdetteOrder`: `isBuyer = !isLong`, "isLong=true means maker sells, so taker buys"). `isLong: false` = maker buys = the taker SELLS and posts collateral. `quoteFill` gates that side as `TAKER_SELL_UNVERIFIED`; correct. Live book 2026-09-05 01:47 UTC (337 orders): taker-BUY 125 (63 puts paid in aBasUSDC, 27 ETH calls in aBasWETH, 35 BTC calls in cbBTC), taker-SELL 212 (182 in USDC, 30 in aBasUSDC); plain-USDC taker-buy orders: 0 in that snapshot (but USDC taker-buy FILLS occurred within the prior 3 hours; availability changes by the minute). The teammate's agent "tradeable set" (`isLong === false` + USDC) is the taker-SELL side while its copy says "long option … most that can be lost is the premium"; see `.research/thetanuts/finding-isLong-side.md`. Owner ruling needed on which side(s) the product offers.
  - The budget passed to preview/fill is the taker's **premium spend** in collateral base units, not contracts. Contracts are capped at the maker's remaining size. Recompute premium as `numContracts * pricePerContract / 1e8`; never trust `preview.totalCollateral`.
  - Preview returns no max loss or max payout. Settlement is automatic on r12; `client.option.payout()` throws.
  - Do not use: `filterOrders` (drops `rawApiData`), `client.events.getOrderFillEvents` (stale event layout), `mmPricing` beyond ETH/BTC, `swapAndFillOrder`, RFQ, MCP.
- **Fill debits VERIFIED from decoded production fills 2026-09-05** (`.research/thetanuts/finding-fill-debits.md`, tx hashes inside): taker-BUY pays premium = numContracts × price / 1e8 in the collateral token (fee 12.5% of premium carved out of what the maker receives; maker posts strike × contracts or spread width × contracts); taker-SELL (put) posts collateral = strike × numContracts / 1e8 in the collateral token and receives premium − fee. `numContracts` is in 1e6 units for USDC/aBasUSDC orders (10000 = 0.01). Sell-side CALL collateral (SDK doc: 1:1 underlying) still needs a decoded example.
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
- **Writer and reviewers are different agents.** Owner rule 2026-09-05 ("all towards gpt astra low effort and we review that"; earlier "don't use opus to work things not related to ui"): **every code change is written by codex `gpt-6-astra` at low reasoning** (`codex exec -s workspace-write -m gpt-6-astra -c model_reasoning_effort="low"`; Astra needs codex CLI ≥ 0.153, a Homebrew cask, `brew upgrade --cask codex`) from a pinned brief carrying the no-product-decisions block; **no Opus workers for writing**. Review is two legs: Claude (hands-on, adversarial, not the author) and codex `gpt-6-astra` at **medium** reasoning (owner 2026-09-05: "medium for reviews should be enough, low for work") with a digest-pinned diff and a mandatory `Reviewed <path> SHA-256 <digest>` opener. Fold until both are GREEN. The codex sandbox has no network and no database and cannot write a worktree's git lock (it lives under the main repo's `.git`), so writers leave the tree uncommitted; Claude verifies, runs live tests and builds, and commits. Briefs and transcripts live in gitignored `.research/`.
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

## Current state (keep this true; last updated 2026-09-05 11:09 +0800)

- **`main` = teammate's AI track (origin/main `c30a4e2`) + UI rounds 1–4 (`b88b580`) + DB rounds 1–6 (`0fbd4d6`).** Push of main authorized by the owner on DB GREEN and executed after this update; from here on pushing waits for an explicit owner command again. Fetch origin at the start of every work block.
- **Process**: writers are codex `gpt-6-astra` low; reviews are Claude hands-on + Astra medium; no Opus workers. Codex sandboxes have no network, no DB, and cannot write a worktree's git lock: writers leave trees uncommitted, Claude verifies live and commits. Queue launches with the wrapper counter `pgrep -f '^/bin/bash .*run-astra-'` (never a pattern that matches Claude's own wait shells). Briefs pass values via environment variables to Python, never through unquoted heredocs (a backtick once spliced a `git diff` into a brief).
- **Core trade logic** `packages/thetanuts`: rounds 1–4 GREEN at `e8b0b06` (on main). Sell side on branch `core-r5`: round 5 `6cb674e` (`takerSide`, `quoteSellFill`, `buildSellFillTransactions`; review RED: capacity formula used as seller collateral), round 6 `7d536cc` (implementation-specific collateral via `getOptionImplementationInfo`: PUT = strike, RANGER = inner width, PUT_FLY via the SDK helper; `STRUCTURE_COLLATERAL_UNVERIFIED` gate otherwise; 34 tests; Claude: tsc OK, 34 pass). Astra medium review r6 **RED** (`astra-core-review-r6.out`): the RANGER inner-width formula matched the decoded fill by coincidence (inner gap 1000 = 2 × wing 500) and diverges from the SDK collateral helpers elsewhere; the verified-PUT path ignores collateral token/decimals; the decoded sell fill's implementation `0x6aD5…` is PHYSICAL_PUT (so PHYSICAL_* IS deployed on Base, contrary to the teammate's note). Round 7 (Astra low) next: collateral from the SDK helper for every structure, verified set = exact (implementation, collateral) pairs proven by decoded fills, decimals from the SDK config. Not merged.
- **DB** `packages/db`: **GREEN from both legs at round 6 (`e345ddb` on `db-r4`, merged into main at `0fbd4d6`)**. Chain: `0000_agent_tables` (teammate's, applied to production), `0001_core_schema`, `0002_core_triggers` (deferred creator-invariant triggers with `FOR SHARE` reads in users→positions→theses order, conflict touch-writes for repeatable-read writers, current-row re-reads, snapshot immutability, users-wallet fence). Migrate fence in `drizzle.config.ts`: prints the effective target, rejects `?host=`/`?port=`/`dbname` overrides, requires `DRIZZLE_ALLOW_REMOTE=1` for non-local hosts. Live on the local throwaway: 45 offline, 123 integration, 16 concurrency (RC/RR/SERIALIZABLE). Remaining MINOR from r6 review: concurrency assertions do not record which statement failed (fold with the next DB round). Production migration still pending: needs the Supabase pooler/direct URL reachable from this machine (direct host is IPv6-only here) and `DRIZZLE_ALLOW_REMOTE=1`, then `bunx drizzle-kit migrate`; never `push`.
- **UI** `apps/web`: rounds 1–4 GREEN and merged (`b88b580`): five routes on typed mock data with a domain/display split on the PRD §10.3 contract, BigInt decimal formatting, ARIA/keyboard, providers = teammate's Wagmi/Query outside + forced-dark theme inside. Round 5 (`142985d`, creator-earnings placeholders removed, porting comment fixed): Astra medium review **GREEN** (`astra-ui-review-r5.out`; two MINORs to fold next UI round: dead `fills` data chain in `types.ts`/`display-types.ts`/`display.ts`/`mock/data.ts`, dead `.acc` CSS in `index.css` and the mockup); Claude leg agrees. **Merged into main at `8c587c3`** (typecheck, 23 tests, `next build` 18 routes verified on main). Mockup SHA now `a4a191c0…`.
- **Rewire** (owner order): checkpoint `f932072` on branch `rewire` (agent `getThesisContext` tool reads `@nuts/db`). Order adapter and sizing (B/C) wait for core r6 GREEN, then both sides on `@nuts/thetanuts` with honest sell-side copy in the agent tools.
- **Revenue**: Thetanuts referrer fees (docs "Referrer Fees"): pass the platform address on every fill; fee `min(0.06% notional, 12.5% premium)`; our share `fee × splitBps / 10000` accrues per collateral token; self-claim with `claimFees(token)` FROM the referrer wallet (it must transact on Base and hold gas). The OptionBook owner must whitelist the address and set the split; unwhitelisted = 0 (seen live). Memo: `.research/thetanuts/monetisation-memo.md`. **Platform referrer wallet (owner, 2026-09-05): `THESIS_REFERRER = 0xd5E66B6d957C2d5e6C8c167707a49a029D1247dd`** (EOA on Base; measured at 11:0x +08: `referrerFeeSplitBps` = 0, i.e. not yet whitelisted; ETH balance 0, needs gas before any `claimFees`). Pass it on every quote and fill; owner still has to request the whitelist from Thetanuts. Creator payouts: roadmap only.
- **Verified market facts** (2026-09-05, decoded production fills; `.research/thetanuts/finding-fill-debits.md`, `finding-isLong-side.md`): raw `isLong` is the maker's side; taker-buy pays `contracts × price / 1e8` (fee carved out of what the maker receives); taker-sell put posts `strike × contracts / 1e8`; RANGER seller posts inner width × contracts; contract units 1e6 for USDC-family collateral. Still UNVERIFIED: call-side and spread seller collateral beyond RANGER, non-6-decimal contract units, on-chain rounding, the fee's notional branch, signature-expiry timing (teammate: 59–113 s).
- **Open owner items**: referrer wallet + Thetanuts whitelist; every `TODO-OWNER` (budget presets, trending/ending rules, leaderboard formula, content limits, lock/statement timeouts); `ThesisStatus` display mapping; `/new` composer copy; single detail fixture; connected user unnamed; gap G1 (AI context for draft/pending theses).
- **Incidents today**: machine crash ~05:34 (Astra runs relaunched fresh; OrbStack needs `open -a OrbStack` after reboot); a UI worker's `pkill -f "turbo run dev -F web"` killed the owner's unrelated `naise-ai` dev server (~04:20); Claude briefs twice named non-existent things (`brief-db-writer.md`, `positions.updated_at`) — every name in a brief is verified at the bytes first.
