# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` at the repo root is a symlink to this file so Codex and other agents read the same guidance. Edit this file only. Keep the **Current state** section at the bottom true; update it whenever something lands or changes, with the date.

## Product source of truth

`docs/PRD.md` is the source of truth for product scope, user journeys, team ownership, shared interfaces, safety rules, and acceptance criteria. This file remains the source of truth for repository conventions and implementation guidance. If the two conflict on product behavior, follow the PRD.

## What this repo is

**Thesis.fun** for the Thetanuts hackathon: a social options-trading app in the shape of fomo and pump.fun. A **trade** is a real options position on Thetanuts OptionBook, filled from the user's own wallet on **Base mainnet**, with its own page (`/p/<id>`) and live P&L card. A **post** ("thesis") is text like an X post; it may tag a market, and if its text links a trade (`/p/<uuid>`) the link unfurls into a clickable trade card, X-style. Likes, comments and follows on every post. Every position and result is verifiable onchain; losing theses cannot be deleted.

Owner decisions (all 2026-09-05, verbatim where it matters):
- **Every market Thetanuts has liquidity for.** Derive assets, strikes, expiries live from OptionBook orders. Never hardcode an asset list.
- Base mainnet only (chainId 8453).
- **A trade is just a trade; a post is just a post (14:2x):** "trade is just trade. post(thesis) is it's own thing. doesn't have to be tied. but when a user post it's trade (could be a link to his own live pnl card) in the trade then we render a nice card. u know how like if i share my own posts' link in x, x will render the posts' as a card? and not just the link? and it's clickable cuz issa link, then bring me to that card kinda thing?" Positions are independent rows (`role = 'standalone'`, `thesis_id` null; migration 0007); the market ticket never creates a post; `theses.creator_position_id` stays for the verified badge when a post links the author's own confirmed position — but the frozen 0002 trigger requires `role = 'creator'`, so a standalone trade can NEVER be linked that way today (owner schema decision pending).
- **A thesis is a post (earlier the same day):** "thesis doesn't really need user to actually put a trade first … a pure text opinion is fine also", "allowing users to like that particular thesis also". Text required; market tag optional; structure optional.
- **Trading lives on the per-asset market page** (from the fomo demo): live structures from the book, Bull/Bear ticket, no trade buttons inside posts. **No price chart anywhere (14:1x):** Thetanuts exposes only the live spot price, no history; "remove the chart then if this the case … think for the users man". After a fill, a dialog shows the P&L share card with "Copy link" and "Write a post about it" (fomo reference `.demo/fomo-share-card.png`).
- **Both sides ("do both, go"):** taker-BUY (pay premium; loss bounded) and taker-SELL (lock collateral; receive premium − fee; loss up to the collateral), each with honest sizing and copy. Everything a decoded fill has not proven stays gated in code (`VERIFIED_SELL_PAIRS`, `buyContractSizeDecimals`).
- **Creator payouts are FUTURE ROADMAP** ("we'll put creator fees as future roadmap, but we'll do callouts anyways for now. so we just do our own earning first"). Keep the attribution data; no ledger or payout UI. Roadmap line: "our platform earns through trading fees" = the referrer share below.
- **AI track:** the teammate's approval-gated trading agent stays as built ("keep how they made their ai stuff also. is fine"); `docs/PRD.md` v2.0 stands for it incl. §10.2 limits; rewired onto our packages (`packages/thetanuts` for orders/quotes/calldata, `packages/db` for thesis context). AI never signs; the wallet approves every transaction.
- **No Privy.** Wallet address is the identity (wagmi + viem, Coinbase Smart Wallet included). **Connecting a wallet creates the user profile** (create-or-fetch the `users` row keyed by the lowercase address, idempotent) — built.
- **Revenue = Thetanuts referrer fees** (docs "Referrer Fees"): every quote and fill carries `THESIS_REFERRER` (`packages/env` default = the owner's wallet `0xd5E66B6d957C2d5e6C8c167707a49a029D1247dd`, an EOA on Base); protocol fee `min(0.06% notional, 12.5% premium)` — BOTH branches fire on Base (see Thetanuts); our share `fee × splitBps / 10000` accrues per collateral token and is self-claimed with `claimFees(token)` from that wallet (needs gas). **The OptionBook owner must whitelist the address and set the split** (`setReferrerFeeSplit` is owner-only; unwhitelisted = 0, measured: `referrerFeeSplitBps` 0). Memo: `.research/thetanuts/monetisation-memo.md`.
- **Product numbers and copy are the owner's**: presets, trending/ending/leaderboard rules, content limits, session length, slug/handle bounds, fees, slippage, gas headroom. Tag `TODO-OWNER` in code and UI. Never invent a value.

Team: owner + Claude on product, UI and Thetanuts logic. Teammate on the AI track (feature branches; their push rule is not a merge approval).

Shared contract: `docs/PRD.md` v2.0 §10.3 defines `ThesisAiContext`; `packages/db/src/ai-context.ts` implements it exactly. Neither side changes it without telling the other and updating the PRD (§15).

## Design direction (fomo's feel; owner 2026-09-05 14:3x)

- **Owner (verbatim): "is it me or the ui/ux kinda suck ass again? idk. i still like fomo's feel. it's more classy" → "go with fomo's feel, redo the mockup now in parallel".** The earlier stadium/dark/gold design (Bricolage + Archivo + JetBrains Mono, gold `#F5C542`, icon rail, ticker tape) is gone.
- **Spec = `docs/mockups/thesis-fun-mockup.html`** (self-contained, 7 views + the post-fill dialog + a mobile feed; `docs/mockups/README.md` states the rules; screenshots in `.research/thetanuts/design-r1-shots/`). Design changes go through the mockup first (pixels before prose), then code.
- Tokens on `:root` (declared UNLAYERED in `apps/web/src/index.css`, because `packages/ui` declares shadcn's `:root` unlayered and unlayered beats every `@layer` — measured 2026-09-05 16:2x, accent had rendered grey): `--bg #0b0b10`, `--surface #14141b`, `--surface2 #1b1b24`, `--line #25252f`, `--text #f2f2f5`, `--muted #8d8d9c`, ONE accent `--accent #6f5cff` (+ `--accent-lift #a99bff` for text on tint), `--gain #22c55e`, `--loss #f4634f`.
- **Rules:** one accent, used only on primary buttons, the active tab underline, the selected side, the share-card frame, the "Open" chip and focus rings. Colour only on money (never bars, labels, names); the percent beside a P&L is neutral with a coloured arrow. `Manrope` only, `tabular-nums` on numbers; no mono, no display face. Radius by role (frame 24 · card 18 · panel/field 14–16 · row 12 · chip 999). Hairlines, not shadows (the dialog is the one blurred shadow). Base 14px, post body 16px, hero P&L 48px.
- **Chrome:** slim top bar (logo, centred search, wallet chip), horizontal nav `Feed · Markets · Leaderboard · Portfolio` with an accent underline, a persistent LEFT feed rail on every page except the feed, a RIGHT panel (ticket / positions / top traders), avatars everywhere. Posts look like a person said something. The share card (owner + status chip + date, instrument, huge signed P&L + percent, three stat tiles) is the position-page hero, the post-fill dialog and the trade card inside posts. No charts. Mobile (≤900px) hides both rails; ≤1180px hides the right column per the mockup's own CSS — which makes the ticket unreachable on a phone (`TODO-OWNER`).
- The TradingView chart library was removed with the chart (`lightweight-charts` uninstalled; the owner's "keep the logo" ruling is moot).

## Thetanuts integration

- SDK: `@thetanuts-finance/thetanuts-client@0.3.0` (ethers v6 + viem), installed in `packages/thetanuts`. Docs: https://docs.thetanuts.finance/sdk (append `.md` to a page URL; full export at `/llms-full.txt`).
- **Read `docs/thetanuts-sdk-research.md` before touching the SDK.** It is a 999-line research report written by a codex sol and verified by Claude against the SDK bytes (14 load-bearing citations re-read). Its prompt is beside it.
- Verified facts that shape the code:
  - `encodeFillOrder` and `encodeApprove` return `{to, data}` calldata; wagmi/viem send them. No ethers signer needed for the app.
  - `client.api.fetchOrders()` returns every live maker order; assets come from `buildPriceFeedSymbolMap(8453)` (eight feeds configured: ETH, BTC, SOL, DOGE, XRP, BNB, PAXG, AVAX).
  - In a browser the client constructor throws unless `keyStorageProvider` is passed; use `MemoryStorageProvider`. RFQ is never used.
  - **Raw `isLong` is the MAKER's LONG flag — CORRECTED 2026-09-05 14:4x from chain bytes (`.research/thetanuts/finding-taker-side-inverted.md`): `isLong: true` → maker is the buyer → the TAKER SELLS and posts collateral; `isLong: false` → maker sells → the TAKER BUYS and pays premium.** The SDK comment at `normalizeOdetteOrder` ("isLong=true means maker sells, so taker buys") and its `isBuyer = !isLong` are WRONG; `packages/thetanuts/src/side.ts` was inverted until core round 9. Proof: tx `0x9c4bb1…` (`isLong=false`, taker = `OrderFilled.buyer`, paid 999998 USDC premium) and `0xdf3323…` (`isLong=true`, taker = `seller`, posted 22,000,000 aBasUSDC). Live book 2026-09-05 01:47 UTC (337 orders), corrected: isLong=true 125 = taker-SELL (aBasUSDC/aBasWETH/cbBTC collateral), isLong=false 212 = taker-BUY (182 in USDC, 30 in aBasUSDC). The teammate's agent "tradeable set" (`isLong === false` + USDC, "long option … most that can be lost is the premium") was RIGHT; Claude's `finding-isLong-side.md` is retracted. Every earlier statement of the opposite in this file is superseded by this bullet.
  - The budget passed to preview/fill is the taker's **premium spend** in collateral base units, not contracts. Contracts are capped at the maker's remaining size. Recompute premium as `numContracts * pricePerContract / 1e8`; never trust `preview.totalCollateral`.
  - Preview returns no max loss or max payout. Settlement is automatic on r12; `client.option.payout()` throws.
  - Do not use: `filterOrders` (drops `rawApiData`), `client.events.getOrderFillEvents` (stale event layout), `mmPricing` beyond ETH/BTC, `swapAndFillOrder`, RFQ, MCP.
- **Fill debits VERIFIED from decoded production fills 2026-09-05** (`.research/thetanuts/finding-fill-debits.md`, tx hashes inside): taker-BUY pays premium = numContracts × price / 1e8 in the collateral token (fee 12.5% of premium carved out of what the maker receives; maker posts strike × contracts or spread width × contracts); taker-SELL (put) posts collateral = strike × numContracts / 1e8 in the collateral token and receives premium − fee. `numContracts` is in 1e6 units for USDC/aBasUSDC orders (10000 = 0.01). Sell-side CALL collateral (SDK doc: 1:1 underlying) still needs a decoded example.
- **Fee: BOTH branches fire on Base.** The second decoded taker-sell (`0x3e7417c5…cff04`, core round 9) paid fee 737 on premium 9009 (8.2%, not 12.5%), so `feeEstimate` is an UPPER BOUND and `scripts/tiny-fill.ts`'s exact fee comparison would report "Receipt mismatch" after a good fill (owner call: loosen or keep strict). What "notional" means on chain is still unmeasured.
- **UNVERIFIED until tested with small real money**: contract-size units for non-USDC-family collateral (cbBTC, aBasWETH — 62 of ~125 live taker-buy orders stay gated); the taker-sell debit for anything other than PHYSICAL_PUT + aBasUSDC (calls, spreads, RANGER as seller); capped-budget rounding on chain; settlement timing and indexer P&L accounting. Code that touches these says so in its doc comment and stays gated.
- `@thetanuts-finance/mcp` was audited clean but is for AI chat clients; the owner ruled it out for the app.
- **Teammate-measured on Base mainnet 2026-09-05 (`docs/HANDOVER.md` §5; NOT re-verified by Claude):** maker signatures expire in 59–113 s and are re-signed about every 60 s, so approve collateral first, then re-fetch and build calldata within ~30 s; the SDK WebSocket host does not resolve (poll 20–30 s); `availableAmount` is the maker's collateral budget, not contracts; the book carries binaries (e.g. "ETH 2460 Up 1D"); tradeable set is USDC-collateral orders with `isLong: false` (~200 of 367); position read-back after a fill needs `api.triggerIndexerUpdate()` and polling; the seven `PHYSICAL_*` multi-leg implementations are not deployed on Base; RFQ has had no offers since 2026-08-20. Treat each as a hypothesis until our own tiny fills confirm it.

## Build status (every step below is CODED and merged on main; the one-shot review is what remains)

Owner's order was UI first, then core, then DB and socials, then wire, then polish. As of 2026-09-05 16:3x:
1. **Core trade logic** `packages/thetanuts`: buy + sell (rounds 1–9). Taker side corrected from chain bytes in round 9. 50 tests.
2. **DB** `packages/db`: migrations `0000`–`0007` (post model, likes, slugs/handles, follow activity, standalone positions), deferred creator-invariant triggers, migrate fence. 348 live tests.
3. **Wallet + fills**: sign-in with wallet (EIP-4361-shaped, single-use nonce, HMAC session), profile on connect, market page on the live book, ticket → quote → approve/simulate/fill → `recordTrade` from chain bytes (standalone positions; participant via `?thesis=`), post-fill share dialog, `/p/[id]` with the P&L card and share image.
4. **Socials**: posts (`publishPost`, `/p/` link unfurl → trade card), likes, comments, follows (+ activity), feed tabs, trending/ending/settled, leaderboard, profile editing (handle/name/bio). Every ranking/limit is `TODO-OWNER`.
5. **Polish**: Open Graph cards on `/t/` and `/p/`, `docs/DEPLOY.md`, `bun run verify`, env parity test, README.
6. **UI rebuilt on the fomo mockup** (three lanes merged; one fold round in flight).
Not yet: the one-shot two-leg review (GREEN required before anything reaches production), the production migration, Vercel, the owner's tiny real fill.

Parallel track (teammate): AI track per `docs/PRD.md` v2.0 (`/agent`, `apps/web/src/lib/agent/*`, `packages/db/src/schema/agent.ts`, migration `0000_agent_tables`); their `origin/agent-exec-r1` (approval-gated execution on our `buildFillTransactions`) is not merged.

## How work is done here (owner rules, verbatim where it matters)

- **"NEVER TRUST YOURSELF, DON'T FUCKED UP."** Every claim, number, name and file path is verified at the source before it is used or said. A sol's output and Claude's own output are invalid until re-measured. Load the `verify-first` skill before claims and the `fable-method` skill before hard tasks.
- **Zero confidence in everyone, including yourself** (owner, verbatim: "none of yall should trust yourselves or the other. zero confidence in everyone's responses and findings"). Every brief carries this clause; every claim in a report is pasted measurement or it is not a claim; the orchestrator re-measures every headline number and every finding before folding or relaying it.
- **CODE FIRST, ONE-SHOT REVIEW (owner 2026-09-05 13:2x, verbatim: "let's skip all reviews. code ito ut first. then on shot review. keep in track what to review can already").** Refined by the owner minutes later (verbatim): "one opus high reasoning one astra low reasoning to code everything out first. then due to not trusting them, we review and verify. but don't trust yourself too later btw / also the reviews should do all under one astra medium and yourself, try to one shot the review also so it takes lesser rounds to reach where we want. i'm not asking we should lower our work quality btw". So: writers = ONE Opus agent at HIGH reasoning + ONE codex `gpt-6-astra` at LOW, in parallel, own worktrees; the review = the USUAL two-leg review (Astra MEDIUM + Claude hands-on, adversarial, digest-pinned, fold until GREEN), run ONCE after all the code is finished (owner 13:4x, verbatim: "the one shot review is meant for you to complete all the code then do the usual 2 leg review is what i meant. except we finish the work first then only review instead of plan -> code -> review -> plan fix -> code -> repeat until green which takes a lot of time"); Claude's own verification is re-measured in that pass too. No per-round adversarial reviews until the owner calls the pass. Claude still verifies every writer's claims (typecheck, tests, build, spot-checks at the bytes) before committing and merging — that is verification, not review. Everything merged unreviewed, and every carried finding, is logged in `.research/thetanuts/review-ledger.md` with what the one-shot review must attack. Nothing reaches production before that review is GREEN — owner 13:4x, verbatim: "the one shot review goes before we push for actual db migration on prod's db." Order: code → Claude verification → one-shot review GREEN → production `drizzle-kit migrate` (never `push`) → Vercel → real-money fills. The paragraph below describes the review shape when it runs.
- **Writer and reviewers are different agents.** Owner rule 2026-09-05 ("all towards gpt astra low effort and we review that"; earlier "don't use opus to work things not related to ui"): code is written by Opus workers (Agent tool, own worktree, fable-method first) AND codex `gpt-6-astra` at low reasoning (`codex exec -s workspace-write -m gpt-6-astra -c model_reasoning_effort="low"`; Astra needs codex CLI ≥ 0.153, a Homebrew cask, `brew upgrade --cask codex`), workload balanced between the two (owner 11:20 +08, superseding the earlier "no Opus for non-UI"), always from a pinned brief carrying the no-product-decisions block. Review is two legs: Claude (hands-on, adversarial, not the author) and codex `gpt-6-astra` at **medium** reasoning — **while codex is out of credits (from 2026-09-05 12:12 +08 until Sep 10 15:01, codex's own message) the second leg is a fresh Opus adversarial agent, decided by Claude and flagged to the owner** — (owner 2026-09-05: "medium for reviews should be enough, low for work") with a digest-pinned diff and a mandatory `Reviewed <path> SHA-256 <digest>` opener. Fold until both are GREEN. The codex sandbox has no network and no database and cannot write a worktree's git lock (it lives under the main repo's `.git`), so writers leave the tree uncommitted; Claude verifies, runs live tests and builds, and commits. Briefs and transcripts live in gitignored `.research/`.
- Parallel writers get separate git worktrees. Never two agents in one mutable tree. **Reviewers too: a detached worktree pinned at the reviewed commit** — Claude keeps committing state to the main checkout, which broke a review's HEAD pin on 2026-09-05.
- **Wide fan-out (owner 2026-09-05: "do everything at once so we spend lesser rounds … instead of brick by bricks")**: launch every independent piece in parallel with complete briefs (all known findings folded up front, completeness checklist), review with all lenses in one round, fold until GREEN.
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
bun run verify              # scripts/verify.ts: typecheck + every suite + both builds (--offline skips live DB suites and builds)
cd packages/thetanuts && bun test          # offline unit tests for the trade logic
cd apps/web && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/<migrated-throwaway> bun test   # web suite incl. integration files (they skip without DATABASE_URL)
# Smoke a PRODUCTION build only in DB mode against a migrated throwaway (next start refuses mock fixtures by design):
# cd apps/web && DATA_SOURCE=db DATABASE_URL=... bunx next start -p 3124
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
bun run env:preview | env:production   # push apps/web/.env to Vercel (scripts/sync-vercel-env.ts reads .env only, NOT .env.local)
bun run deploy | deploy:prod | deploy:check
```

No lint setup yet; `turbo.json` declares a `lint` task nobody implements.

## Architecture

Turborepo monorepo, all TypeScript, ESM. Workspaces: `apps/*` and `packages/*`. Shared dependency versions live in the root `package.json` `catalog` and are referenced as `"catalog:"`.

```
apps/web             Next.js 16 app (App Router, React 19, React Compiler on, typedRoutes on)
packages/thetanuts   @nuts/thetanuts: framework-agnostic trade logic on the Thetanuts SDK (+ bun tests)
packages/db          Drizzle ORM + node-postgres. Schema in src/schema, migrations in src/migrations
packages/env         Validated env via t3-env. `@nuts/env/server` (DATABASE_URL, DIRECT_DATABASE_URL?, SESSION_SECRET (≥32; required in production), DATA_SOURCE (mock|db; production refuses mock at runtime, build phase exempt), NODE_ENV, OPENROUTER_API_KEY, AGENT_MODEL, AGENT_GATE_MODEL, BASE_RPC_URL, THESIS_REFERRER, THETANUTS_ORDERS_URL), `@nuts/env/web`, `@nuts/env/load` (repo-relative .env.local/.env loader; note: it also fills values into test/probe processes, so an "unset" probe must set the variable to an empty string)
packages/ui          Shared shadcn/ui components on @base-ui/react + Tailwind v4. Exports globals.css, components/*, lib/*, hooks/*
packages/config      Shared tsconfig.base.json (strict, noUncheckedIndexedAccess, noUnused*)
docs/                PRD.md (v2.0), DEPLOY.md (runbook), HANDOVER.md (teammate), thetanuts-sdk-research.md (+ dated corrections), mockups/ (the spec + README)
scripts/             verify.ts (bun run verify), sync-vercel-env.ts (env:preview / env:production; reads .env only)
.research/, .demo/   Gitignored: Astra/sol briefs, transcripts, review diffs, findings; reference videos and screenshots
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
- **Providers**: `apps/web/src/components/providers.tsx` wraps the app in the teammate's `WagmiProvider` (`apps/web/src/lib/wagmi.ts`: Base only, injected + Coinbase Smart Wallet, cookie storage) and `QueryClientProvider`, then the forced-dark next-themes `ThemeProvider` and the sonner `Toaster`.
- **Web layout** (`apps/web/src`): `app/` routes `/`, `/m/[asset]`, `/p/[id]` (+ OG images), `/t/[slug]` (+ OG images), `/u/[handle]`, `/new`, `/portfolio`, `/agent`, `api/agent/chat`; `lib/` = `auth` (sign-in, sessions), `data` (DB reads, mappers, `DATA_SOURCE` switch), `market` (live book, taker side, quotes), `trade` (prepare/record/ticket), `thesis` (links, publish, enrich), `position` (instrument, P&L derivation, view), `social`, `profile`, `thetanuts` + `agent` (the AI adapter), `display*.ts` + `view-data.ts` (view layer on typed mock data); `components/` = `shell` (top bar, nav, feed rail, page frame), `primitives`, `feed`, `market`, `position`, `thesis`, `creator`, `auth`, `agent`. Domain types in `types.ts`, view types in `lib/display-types.ts`. Two handoff notes live under `src/` (`lib/social/REPORT.md`, `lib/data/REPORT.md`, `lib/profile/REPORT.md`).
- **Vercel**: `vercel.json` deploys `apps/web` as the single `web` service with a root-level `bun install`.

## Next.js version warning

`apps/web/AGENTS.md` is auto-generated by `next dev` and says this Next.js 16 differs from training data. Before writing Next.js code, read the relevant guide under `apps/web/node_modules/next/dist/docs/`. Do not delete that file; `next dev` re-creates it.

## Current state (keep this true; last updated 2026-09-05 16:45 +0800)

- **main = `8fff975` (pushed).** Everything in "Build status" is merged. Verified on main at the last merge (16:2x): `bun run check-types --force` 3/3; thetanuts 50, DB 348 (live, fresh throwaway at 0007), env 10, web 375 live / 275 offline (23 skipped integration cases); `next build` in mock and db mode; a production-build smoke in db mode against a migrated throwaway: every route 200 (unseeded ids 404), zero server errors; browser: `--accent #6f5cff`, Manrope, live structures on `/m/btc`.
- **Running now:** (1) Opus HIGH **UI fold round 1** in `.claude/worktrees/ui-fold-r1` from `.research/thetanuts/brief-ui-fold-r1.md` (25 items: `PagesFrame` → `PageFrame` + `FeedRail`; delete `--tn-*` from `packages/ui`; pills become feed filters; tab "All"; Follow in the rail with follow state; ONE `PnlCard` for the three card view models incl. the fill dialog via a widened `FillCard`; duplicate card on backed+linked posts; status-chip copy; pages parity; dead components; label fixes; mock `/p/` fixture; mobile-ticket `TODO-OWNER`; 390px nav overflow). (2) Astra MEDIUM **review of Lane A** (`packages/db`, `packages/env`, `packages/thetanuts`) in the pinned worktree `.claude/worktrees/review-lane-A` @ `510226c` → `review-oneshot/astra-review-A-r2.out` (its first run stopped on a HEAD-pin mismatch because Claude committed to the main checkout mid-review).
- **Review so far (owner rule: usual two-leg review, run once after all code; GREEN before the production migration):** lanes and briefs in `.research/thetanuts/review-oneshot/` (`lane-A-db-env.md`, `lane-B-server-social.md`, `lane-C-trade.md`, `lane-D-ui.md`; `common-header.md` with pin placeholders); the ledger of everything merged unreviewed is `.research/thetanuts/review-ledger.md` (items 1–25). Claude legs done: A (`claude-review-A.md`: no MAJOR; MINORs — `PGOPTIONS`/`PGSERVICE` env bypass the migrate fence; accented letters dropped from slugs), B (`claude-review-B.md`: challenge reuse + single use, draft/self/anon/blank fences, handle race → `handle_taken`, caller-supplied userId ignored, injected display name stored as text — no MAJOR), C partial (`claude-review-C-partial.md`). Lanes B/C/D Astra legs and pins wait for the UI fold to land (their diffs would shift).
- **Next, in order:** fold lands → merge + verify (typecheck, suites live, both builds, db-mode smoke, browser pass per route vs the mockup shots) → pin lanes B/C/D → Astra medium legs (two at a time, pinned worktrees) + Claude legs → ONE fold of all findings → confirming round → GREEN → production migration (`docs/DEPLOY.md`; needs the owner's session-pooler URL; never `push`) → Vercel (`SESSION_SECRET`, `DATA_SOURCE=db`, pooler `DATABASE_URL`, `OPENROUTER_API_KEY`) → the owner's tiny real fill (`packages/thetanuts/scripts/README.md`).
- **Owner items open:** Supabase session-pooler URL (IPv4, 5432; the direct host is IPv6-only from this machine); Vercel env values; referrer wallet whitelist by Thetanuts + gas on `0xd5E6…47dd`; the tiny real fill (also proves non-USDC contract units and unlocks the gated buy orders); product calls — verified badge for a post linking a standalone trade (schema cannot link it), Bull/Bear naming on a post-less position, `tiny-fill.ts` fee check strict vs upper bound, whether the teammate's `origin/agent-exec-r1` joins the review, mobile ticket hidden ≤1180px by the mockup, accented-letter slugs; every `TODO-OWNER` (presets `$50/$100/$500/$1,000` in code vs `$10/…` in the mockup, rankings, limits, copy, card width, percent basis).
- **Verified facts that gate the code** (all from chain bytes or the SDK bytes, this session): raw `isLong` is the maker's long flag (`true` → taker SELLS); taker-buy pays `contracts × price / 1e8`; taker-sell PHYSICAL_PUT + aBasUSDC posts `strike × contracts / 1e8`; contract units 1e6 for 6-decimal collateral; both fee branches fire; live book after the side fix: buy USDC 170 + aBasUSDC 30 executable, sell aBasUSDC 63 executable, sell aBasWETH/cbBTC gated; OptionBook `0x1bDff855d6811728acaDC00989e79143a2bdfDed`; makers re-sign about every 60 s (teammate-measured, not re-verified).
- **Process facts that bit today (rules now in memory + above):** writers and reviewers each get their own worktree (a mid-review commit to the main checkout aborted a review; `git checkout <file>` in a writer's tree destroyed unstaged edits — recovered from the transcript); the local `postgres` database is a shared throwaway that lags behind migrations — every live run uses its own migrated database; `next start` is production and refuses mock fixtures; `@nuts/env/load` fills probe processes from `.env`; wait loops poll the wrapper path + the `tokens used` footer; a `tokens used` footer does not prove a codex run finished its work; both accounts hit session limits today (codex 12:12–13:15; Claude ~13:1x and ~15:0x) — killed subagents are resumed with "continue, don't redo", their on-disk work survives; Claude committed one red merge before its checks finished (repaired next commit) and once listed a known data gap (no price history) as an afterthought instead of before building — never again.
- **History** (rounds, verdicts, hashes) lives in git log, `.research/thetanuts/review-ledger.md`, and the memory index; this section stays a snapshot.
