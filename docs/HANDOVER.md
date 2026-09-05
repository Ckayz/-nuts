# Handover — AI track, 2026-09-05

Written for the core-product developer. Everything below is on `main`.
`docs/PRD.md` remains the source of truth; this is the short version of what
changed while you were away, and what affects your side.

## 1. One thing that can break your work

**Never run `drizzle-kit push` (or `bun run db:push`) against the Supabase
project.** `push` reshapes the database to match the schema of whoever runs it,
so running it from a tree that does not contain my `agent_*` tables will drop
them — and once you add yours, my running it would drop yours.

Use migrations instead:

```bash
cd packages/db && bunx drizzle-kit generate --name <change>   # writes reviewable SQL
cd packages/db && bunx drizzle-kit migrate                    # applies it
```

`push` is fine against a local throwaway database and nowhere else.

## 2. Scope changed: the AI is a trading agent, not a companion

PRD v1 had AI explaining theses only. **PRD v2 makes it an approval-gated
trading agent**, which enters the AI x Options track alongside the SDK track.

It never signs or submits. It prepares a transaction; the user's wallet
approves every write. Sponsor docs list this as a supported pattern.

New section **PRD 10.8 Scope enforcement**: the agent answers product questions
only, enforced by a classifier that runs before the model. Beginner options
questions are explicitly in scope.

## 3. Environment setup changed

- `apps/web/.env` is gone. Real values live in **`apps/web/.env.local`**, and
  **`apps/web/.env.example`** is committed and documents every variable.
- **Two database URLs.** `DATABASE_URL` is Supabase's transaction pooler (6543),
  used by the app. `DIRECT_DATABASE_URL` is the direct connection (5432), used
  only by drizzle-kit. Schema changes cannot run through the pooler.
- `bun --env-file=...` is no longer needed anywhere. `@nuts/env/load` resolves
  env files relative to the repo, so scripts run from `packages/db` see the same
  values the web app does.
- `apps/web/tsconfig.json` target is now ES2022. bigint literals are unavoidable
  in this codebase.

## 4. Database state

The Supabase `public` schema was empty. It now has six `agent_*` tables from
migration `0000_agent_tables.sql`. **Nothing of yours was touched, because
nothing of yours existed yet.** Your tables are still yours to design; add them
alongside in `packages/db/src/schema/` and export from `index.ts`.

## 5. Verified Thetanuts behaviour that affects your manual flows too

Measured live against Base mainnet on 2026-09-05, not read from docs:

- **Order signatures expire in under a minute** (59-113s observed; makers
  re-sign about every 60s). You cannot show an order, wait for a USDC approval,
  then fill *that* order — it will have expired. Approve collateral first, then
  re-fetch and build calldata within ~30s of signing. The instrument persists
  across re-signing while the price drifts, so show a price-drift tolerance.
- **`client.api.filterOrders()` is broken.** It reads `response.orders` while
  the payload nests under `data.orders`, and the upstream worker ignores query
  parameters entirely. Use `fetchOrders()` and filter client-side.
- **The SDK's WebSocket host does not resolve.** `subscribeOrders()` cannot
  work. Poll on a 20-30s interval.
- **`availableAmount` is the maker's collateral budget, not a contract count.**
  Reasoning on it directly is wrong by orders of magnitude. Always size through
  `previewFillOrder`.
- **The book has binaries.** Alongside vanillas and multi-leg structures there
  are products named like `"ETH 2460 Up 1D"` — a direction, a level, a deadline.
  That is the same shape as a thesis and by far the easiest thing to explain to
  a first-time user. Worth considering for the create-thesis flow.
- Tradeable set is USDC-collateral orders with `isLong: false`, roughly 200 of
  367 open orders, across BTC, ETH, BNB, SOL, AVAX and XRP.
- Position read-back after a fill is asynchronous: call
  `api.triggerIndexerUpdate()` and poll.
- The seven `PHYSICAL_*` multi-leg implementations are not deployed on Base.
- RFQ is scoped thin (create and cancel only) and is not on the demo path: the
  RFQ market has had no new offers since 2026-08-20.

## 6. What I need from you

The one interface between us, defined in **PRD 10.3**: a server-side
`getThesisContext(thesisId)` returning `ThesisAiContext`. Money and quantities
cross it as decimal strings.

My `getThesisContext` tool is currently a stub that tells the model thesis data
does not exist and to offer live market data instead. When your version lands,
I swap the stub for it and nothing else changes.

Beyond that I am not blocked on you, and you are not blocked on me.

## 7. Where the AI track is

Done: env and wallet providers, agent tables, OptionBook order service, the four
read tools, the scope gate, `POST /api/agent/chat`, and the `/agent` page. It
answers questions about live liquidity today.

Next: approval-gated execution — approve USDC, re-fetch, hand calldata to the
user's wallet.

---

## 8. Update 2026-09-05 20:xx — for the fold's Writer A

### F15 is already fixed on `origin/agent-exec-r1`. Do not fix it twice.

`OPEN-WORK.md` lists F15 as a BLOCKER: `/agent` posts to `/api/chat` instead of
`/api/agent/chat`.

Correct on `main`, where `agent-chat.tsx` calls bare `useChat()` and so falls
back to the SDK default `/api/chat`. **Already fixed on the branch you are
merging**, in the second commit (`03186d1`), at `agent-chat.tsx:44`:

```ts
const [transport] = useState(() => new DefaultChatTransport({
  api: "/api/agent/chat",
  prepareSendMessagesRequest: ({ messages, body }) => ({
    body: { ...body, messages, walletAddress: addressRef.current },
  }),
}));
```

The transport is not only about the path. `prepareSendMessagesRequest` attaches
the connected wallet to **every** request, including the turn the runtime resumes
by itself after a tool approval, which a per-send `body` would miss. The address
is read through a ref so the transport, created once, is never rebuilt mid-stream.

So: take the branch's version of that file. A separate fix that only changes the
URL would drop the wallet plumbing and the approval resume with it.

### Two other things in that branch worth knowing before review

- **F14 (chain guard) is partly handled already.** `trade-execution.tsx` switches
  to Base before sending and compares the connected wallet against the account
  the calldata was built for, refusing if they differ. It does not yet re-check
  after an in-flight account switch.
- **The signature deadline is enforced twice**, server and client. Maker
  signatures last 59–113s, and a prepared trade can sit on screen for minutes, so
  the button refuses rather than spending gas on a certain revert.

### Still unsent

No transaction has been sent from this UI. The money path is verified only as far
as calldata: real `approve` + `fillOrder` bytes, the 10 USD limit genuinely
refusing on live orders (13.107829 and 19.999996 USD on two ETH puts). The tiny
real fill remains the owner's step, and it is what proves the non-USDC contract
units and unlocks the gated buy orders.

---

## 9. Autonomous trading — researched, parked, resumable

The owner put autonomous signing in scope at 20:xx and revised it to a stretch goal at 21:xx
once the build cost was clear. **Nothing autonomous is in main.** What ships is unchanged: the
agent prepares, the wallet signs.

Recording the findings so nobody spends the hours again.

### The constraint, re-verified twice

`fillOrder(order, signature, referrer)` takes **no recipient**; the position goes to
`msg.sender`. Checked further for an escape hatch and there is none: the `Order` struct has no
taker field, `swapAndFillOrder` has no recipient either, and across the whole
`OPTION_BOOK_ABI` there is no `fillOrderFor`, no meta-transaction entry point and no relayer
path. An agent signing from its own EOA owns the user's option. The only fix is to control
`msg.sender`.

### Coinbase Spend Permissions alone cannot do it

`SpendPermissionManager` (`0xf85210B2…67Ad`, Base, 12,610 bytes, `eip712Domain()` verified)
implements `spend()` as `requireSender(spendPermission.spender)` then
`_transferFrom(token, account, spender, value)` — it **pulls tokens to the spender**. Its
internal `_execute` is hardcoded to `token.approve(manager, value)`; the spender chooses
neither target nor calldata. Coinbase's own README: *"This approach does not enable apps to
make arbitrary external calls from user accounts."* So a spend permission granted to an agent
EOA reproduces exactly the bug above.

### What does work: Base Sub Accounts

A Sub Account is a Coinbase Smart Wallet (ERC-4337, **EntryPoint v0.6**) co-owned by the user's
universal Base Account and by a key the app chooses — and that key may be a plain private key
held on a server. `createSubAccountSigner.ts` in `base/account-sdk` shows the send path is
`wallet_prepareCalls` → `owner.sign({hash})` → `wallet_sendPreparedCalls`, with no popup and no
passkey. Unattended server signing is supported and documented.

The shape that solves the ownership problem:

1. Browser, once: `wallet_addSubAccount` with the server EOA among `keys`.
2. Browser, once: `requestSpendPermission` where **the spender is the Sub Account address, not
   the agent**. Granting it to the agent EOA out of habit collapses the design back to the
   original bug and would not be discovered until mainnet.
3. Server, unattended: one `executeBatch` from the Sub Account containing
   `SpendPermissionManager.spend(permission, premium)` → `USDC.approve(OptionBook, premium)` →
   `OptionBook.fillOrder(...)`. `msg.sender` is the Sub Account throughout, and the user's Base
   Account owns it.

### The trust caveat, to be stated to users in these words

Coinbase Smart Wallet has no module or policy system — `execute` is `onlyEntryPointOrOwner` and
ownership is flat. **The server key is a full owner of the Sub Account** and can move anything
it holds, including the positions. The user's protection is that the Sub Account is scoped to
this app and holds little, and that the spend permission caps what can be pulled from their main
balance per period. That is better than custody. It is not "the agent can only trade."

### What is already available, and what is missing

`viem@2.56.3` — already installed — ships `toCoinbaseSmartAccount` and `entryPoint06Address`, so
the server side needs no new package. Missing: `@base-org/account` (browser opt-in only) and a
**bundler that supports EntryPoint v0.6 on Base**. Coinbase Smart Wallet is v0.6 while most
bundlers default to v0.7; the mismatch fails with opaque validation errors rather than a clear
message. Verify the bundler's v0.6 support before writing any trading logic.

Two further traps worth knowing: signatures must be wrapped as `(uint8 ownerIndex, bytes sig)`
over a replay-safe EIP-712 digest, and the owner index must be read from chain at startup rather
than hardcoded to 1; and the `spend()` call must sit in the same batch as the approve and fill,
or the premium is not there when the fill runs.

### Parked work

`origin/agent-auto-r1`: `agent_hedge_rules` (migration 0009, applied locally only, never to
production) and `apps/web/src/lib/agent/hedge.ts` — a pure evaluator with 26 tests covering both
sides of the floor to one ten-millionth, the exact-cap case, the UTC day rollover, cooling off,
and five malformed-rule shapes. Unmerged on purpose: an unused table in the production migration
chain is a liability during review with no upside.

---

## 10. Production is migrated and the site is up (2026-09-05 ~23:0x)

Two things were blocking the deploy. Both are fixed and verified; the owner
authorised each.

### The Vercel build was failing on variables that were set

The log said `Invalid environment variables: DATABASE_URL, OPENROUTER_API_KEY ...
received undefined` while all four were correctly configured on the project. The
cause was printed at the bottom as a **warning**, not an error:

> the following environment variables are set on your Vercel project, but missing
> from "turbo.json". These variables WILL NOT be available to your application

Turborepo filters the environment strictly. Fixed in `turbo.json` by declaring
every variable `@nuts/env` validates, cross-checked against
`packages/env/src/server.ts` so the two cannot drift (11 validated, 11 declared,
plus `NODE_ENV`). Detail in `docs/TEAM-HOSTING.md` §4b.

**The trap worth knowing:** `bunx next build` passes even when Vercel fails,
because calling next directly bypasses turbo's filter. Only `bun run build`
reproduces it. **Adding a variable to `server.ts` now means adding it to
`turbo.json` too.**

### The production migration is done — this is off your open-items list

Ran from a laptop against `db.<ref>.supabase.co:5432` with
`DRIZZLE_ALLOW_REMOTE=1 bunx drizzle-kit migrate`, never `push`.

Before: 6 tables, migration `0000` only. After: **14 tables, 9 of 9 applied, none
pending.** Nothing was dropped — the chain only adds, and the `agent_*` tables
were untouched.

```
activity · agent_conversations · agent_messages · agent_proposals
agent_receipts · agent_rfq_keys · agent_usage · auth_challenges
comments · follows · likes · positions · theses · users
```

Verified live afterwards: `/` 200 and rendering "Thesis.fun" with the Markets
panel, `/agent` 200, `/portfolio` 200, `/m/eth` 200. Before the migration the
site returned a server error, because the pages were querying tables that did not
exist.

Migration `0009` (`agent_hedge_rules`) is **not** in this chain. It stays parked
on `origin/agent-auto-r1` with the autonomous groundwork; see §9.

### Still open on the deploy

`DATABASE_URL` and `SESSION_SECRET` are set for **Production only**. Preview
deployments therefore still fail env validation. Production is unaffected. Your
own `TEAM-HOSTING.md` §2 says to set every variable for both, with the caveat that
previews would then read production data.

### Worth checking

Devfolio was submitted at 22:50, which is **before** both fixes landed. Anyone who
opened the live link between then and now saw the server error above. It works
now; the submitted URL is worth re-opening once to confirm what a judge sees.

