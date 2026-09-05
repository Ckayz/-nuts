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

