# Thesis.fun Product Requirements Document

**Version:** 2.0  
**Status:** Active source of truth  
**Last updated:** 2026-09-05  
**Hackathon tracks:** Best Product Built on the Thetanuts SDK + AI Agent

## 1. Product Summary

Thesis.fun is a social options platform where market opinions are backed by real onchain positions on Thetanuts, executed on Base mainnet.

A creator publishes a market thesis, commits capital, and signs a real Thetanuts transaction. Other users can inspect the thesis, see its bounded payoff and risk, and either back or counter it with their own independently previewed and signed Thetanuts position. Creator performance and participant P&L are tied to verifiable onchain transactions.

The embedded AI trading agent turns a plain-language goal or selected thesis into up to three bounded-risk choices using live Thetanuts data. It may prepare OptionBook fills and custom OptionFactory RFQs, but it never signs or submits transactions. The connected wallet must approve every onchain action.

**Positioning:** Verified social conviction, not anonymous market calls.

**Tagline:** Put your money where your thesis is.

## 2. Problem and Opportunity

Crypto users discover trading ideas through social feeds, but those ideas are difficult to trust:

- Creators can publish claims without taking financial risk.
- Losing calls can be deleted or reframed.
- Follower counts do not prove trading skill.
- Options can express bounded, capital-efficient views, but their terminology and payoff mechanics are difficult for new users.
- Existing trading interfaces focus on instruments rather than the people, ideas, and track records behind them.

Thesis.fun connects social discovery to verifiable execution. Every backed thesis has an onchain transaction, every participant sees deterministic risk information before signing, and every settled result contributes to a public history.

## 3. Product Goals

### 3.1 Goals

1. Make a real Thetanuts option position understandable and executable from a social thesis.
2. Require financial skin in the game before a thesis is publicly marked as backed.
3. Let users discover, back, or counter theses using their own budget and wallet.
4. Display transaction-backed creator history and participant positions.
5. Make option discovery accessible through a constrained, explainable AI agent.
6. Complete at least one end-to-end Base mainnet AI-assisted trade for the hackathon demo.

### 3.2 Non-goals for v1

- Guaranteed returns, profit promises, or personalized financial advice.
- Autonomous trading, server wallets, or custody.
- Unbounded-loss structures, silent substitutions, automatic retries, or transactions without explicit approval.
- Custody of user funds or private keys.
- Copying a creator's entry price when that price is no longer available.
- Creating a new options liquidity venue or market-making system.
- Supporting chains other than Base mainnet.
- Email, social, or custodial authentication.
- Running a production-grade independent chain indexer during the hackathon.

## 4. Hackathon Alignment

### 4.1 Primary track: Best Product Built on the Thetanuts SDK

Thesis.fun qualifies through meaningful use of Thetanuts:

- Browse live OptionBook orders.
- Derive supported assets, strikes, structures, and expiries from current liquidity.
- Preview fills for a user-selected budget.
- Approve collateral and fill an order from the user's wallet.
- Record the option address and transaction hash.
- Read open positions, settlement, and payout data.
- Attribute app-originated positions through the configured referrer when supported by the selected SDK path.

### 4.2 AI agent track

Thesis.fun qualifies through an agent that can inspect live OptionBook liquidity, gather risk constraints, prepare a real OptionBook fill or custom OptionFactory RFQ, and guide the user through wallet-approved execution on Base mainnet. The agent itself never controls a key or bypasses wallet confirmation.

## 5. Target Users

### Thesis creator

A trader who wants to publish a market view, prove conviction with capital, build a verifiable record, and attract followers.

### Thesis participant

A crypto user who discovers ideas socially and wants to back or counter a thesis after reviewing the payoff and maximum loss.

### Options learner

A user who understands a market opinion but needs help interpreting spreads, strikes, premiums, expiry, and settlement.

## 6. Product Principles

1. **Onchain proof over social claims.** A thesis is not “Backed Onchain” until its creator transaction is confirmed.
2. **Risk before action.** Previewed cost, maximum loss, maximum payout, expiry, and key conditions appear before the wallet prompt.
3. **Users make the final decision.** The agent may suggest choices, but every transaction requires a clear preview and wallet approval.
4. **AI proposes; deterministic code calculates.** The SDK and application logic own financial values and calldata.
5. **Live liquidity is authoritative.** Never hardcode assets, strikes, expiries, prices, or available structures.
6. **Every wallet signs its own position.** Joining a thesis never copies funds or grants custody.
7. **No stale execution.** Refresh and preview the selected order immediately before signing.
8. **Clear provenance.** Distinguish onchain facts, app-computed estimates, creator commentary, and AI explanations.

## 7. Core Concepts

### 7.1 Thesis

A thesis contains:

- Creator wallet and public profile.
- Creator-written headline and optional rationale.
- Underlying asset derived from a live OptionBook order.
- Direction: `bull` or `bear` for v1.
- Expiry.
- Selected product type and strike set.
- Immutable snapshot of the order used for the creator's entry.
- Creator transaction hash, option address, entry economics, and confirmation state.
- Aggregate participant and social activity.

The public thesis state is one of:

- `draft`: not public and no successful creator trade.
- `pending`: creator transaction submitted but not confirmed.
- `open`: creator transaction confirmed and expiry is in the future.
- `expired`: expiry passed but settlement is not yet available.
- `settled`: settlement and final payout are available.
- `cancelled`: draft or failed creation intentionally abandoned.

### 7.2 Sides

- **Back:** take exposure in the same direction as the thesis.
- **Counter:** take exposure in the opposing direction.

The creator manually chooses their order and direction. A participant also manually chooses from compatible live orders for the selected side. The app may filter compatible orders by underlying asset, expiry, direction, and supported structure, but it must not make the decision for the user.

Participant positions do not promise the creator's entry price or exact payoff. Every participant receives a fresh preview for their selected order and budget.

### 7.3 Backed Onchain

The badge is shown only after the application verifies a successful Base mainnet transaction receipt and associates the resulting position with the creator wallet and thesis.

### 7.4 Financial truth

- The chain, Thetanuts contracts, and indexed contract events are authoritative for transactions, ownership, and settlement.
- The current Thetanuts order feed is authoritative for fillable liquidity.
- Thetanuts SDK calculations and deterministic application code are authoritative for previews and payoff values.
- Database records are an application index and social layer, not proof of financial state.

## 8. Required User Journeys

### 8.1 Connect and authenticate

1. User connects a wallet through wagmi/viem on Base mainnet.
2. Coinbase Smart Wallet must be available among the supported connectors.
3. If the wallet is on another chain, the app requests a switch to Base and blocks trading until complete.
4. The server issues a single-use challenge.
5. The user signs the challenge.
6. The server verifies address, signature, domain, nonce, and expiration, then establishes a secure session.
7. No private key or seed phrase enters the application.

### 8.2 Create and back a thesis

1. Authenticated creator opens the creation flow.
2. App fetches current OptionBook orders.
3. Creator filters available markets and manually selects an order.
4. App derives asset, expiry, product type, strikes, collateral, and direction from the selected order.
5. Creator enters a headline, rationale, and budget.
6. App previews the fill and displays cost, fees, maximum loss, maximum payout, expiry, and payoff scenarios.
7. Creator explicitly acknowledges the risk summary.
8. App requests collateral approval only when current allowance is insufficient.
9. App refetches the exact order and previews it again immediately before execution.
10. Creator signs and submits the fill through their wallet.
11. App waits for a successful receipt, records the transaction and returned position identifiers, then publishes the thesis.
12. Indexer delay is represented as a syncing state, not a failed trade.

If execution fails or the order is stale, the thesis remains a private draft and is not marked Backed Onchain.

### 8.3 Discover theses

The feed supports these views:

- New.
- Trending.
- Ending soon.
- Settled.

Every card shows creator, headline, asset, direction, expiry, backed status, participation summary, and the creator position's current or final status. Ranking formulas and numeric thresholds remain owner-controlled decisions.

### 8.4 Back or counter a thesis

1. User opens a thesis and reviews its creator position.
2. User selects Back or Counter.
3. App fetches compatible live orders for that asset, expiry, and direction.
4. User manually selects an available order and enters a budget.
5. App previews that user's actual fill and displays their own economics.
6. User approves collateral if required and signs the fill.
7. App verifies the receipt and adds the position to the thesis activity and user's portfolio.

If no compatible order is available, the relevant action is disabled with an explicit liquidity message. The app must not silently substitute another asset, expiry, or direction.

### 8.5 Portfolio and settlement

1. Portfolio displays positions created through Thesis.fun for the connected wallet.
2. Open positions show entry information, expiry, current status, and clearly labeled estimated P&L when available.
3. Expired positions show settlement pending until Thetanuts publishes settlement.
4. Settled positions show settlement price, payout, fees, and final P&L.
5. The creator's public history updates from confirmed settled positions.

### 8.6 Discover and trade with the AI agent

1. User opens `/agent` directly or passes a selected thesis as trusted context.
2. The agent asks for any missing budget, direction, expiry preference, and maximum acceptable loss.
3. The user chooses listed OptionBook liquidity only or allows a custom RFQ.
4. Read tools inspect current Thetanuts data and present at most three choices.
5. Each choice clearly labels source, timestamp, expiry, cost/collateral, maximum loss, and key payoff conditions.
6. The user selects a choice and explicitly approves transaction preparation.
7. The server refreshes the source data, reruns deterministic validation, and returns calldata only if the preview still matches the approved limits.
8. The connected wallet displays and submits the transaction on Base mainnet.
9. The app records the transaction hash and tracks confirmation. RFQs additionally expose offer monitoring, user-selected settlement, and cancellation.

## 9. Functional Requirements

### 9.1 P0 — Hackathon-critical

- Base mainnet wallet connection and wallet-signature authentication.
- Live OptionBook discovery with no hardcoded market list.
- Manual or AI-assisted order selection with an explicit budget and loss limit.
- Deterministic fill preview and risk display.
- Collateral allowance check and approval.
- User-signed OptionBook fill using the Thetanuts SDK's external-wallet calldata path.
- Transaction receipt verification and position persistence.
- Thesis creation gated by the creator's confirmed transaction.
- Feed, thesis detail, create flow, and portfolio.
- Open, expired, syncing, failed, and settled states.
- Responsive `/agent` workspace with discovery and thesis-context entry points.
- OpenRouter model integration through the Vercel AI SDK.
- Approval-gated OptionBook transaction preparation and custom RFQ lifecycle.
- Responsive UI and explicit loading, empty, error, and wallet-rejection states.

### 9.2 P1 — Important after the end-to-end trade works

- Back and Counter participant flows.
- Comments and follows.
- Activity feed.
- Creator history and verified performance display.
- New, trending, ending-soon, and settled feed filters.
- Shareable thesis links and Open Graph cards.

### 9.3 P2 — Post-hackathon

- Notifications.
- Independent production indexer.
- Advanced creator analytics.
- Additional thesis directions such as range-bound views.
- AI localization and voice explanations.
- Owner-approved AI trade-agent mode as a separate product surface.

## 10. AI Trading Agent Specification

### 10.1 Responsibilities

The AI agent may:

- Summarize the creator's thesis.
- Explain the option structure and each strike.
- Explain how the position can make or lose money.
- Explain maximum loss, maximum payout, break-even values, and expiry when supplied by trusted calculations.
- Search and rank live choices that satisfy explicit user constraints.
- Prepare deterministic OptionBook and OptionFactory RFQ calldata after approval.
- Monitor RFQ state and offers, then prepare settlement or cancellation calldata selected by the user.
- Explain current versus settled P&L.
- Answer beginner follow-up questions.

The AI agent must not:

- Invent a budget, maximum loss, expiry, asset, or direction.
- Claim a probability of profit unless a trusted deterministic value is explicitly supplied and labeled.
- Calculate authoritative prices, payout, P&L, or risk from scratch.
- Sign, submit, automatically retry, or silently alter a transaction.
- Request unlimited token allowance.
- Access private keys, seed phrases, or unrestricted wallet permissions.
- Promise or imply guaranteed profit.

### 10.2 Safety contract

- Base mainnet and USDC collateral only for v1.
- `maximumLossUsd <= 10` and `requiredCollateralUsd <= 10` for agent-prepared trades.
- Only bounded, fully collateralized structures are eligible.
- Allowances must be exact for the approved transaction.
- A fresh order/RFQ state and deterministic preview are mandatory immediately before calldata is returned.
- If any material value changes, stop and require a new user approval.
- Guest users receive ephemeral discovery only. Wallet authentication is required for persistence and execution.
- Default daily model limits are 10 turns per guest IP and 50 per authenticated wallet.

### 10.3 Shared thesis context contract

The core product must expose a server-side function equivalent to:

```ts
type ThesisDirection = "bull" | "bear";
type ThesisStatus =
  | "draft"
  | "pending"
  | "open"
  | "expired"
  | "settled"
  | "cancelled";

interface ThesisAiContext {
  thesis: {
    id: string;
    headline: string;
    rationale: string | null;
    direction: ThesisDirection;
    status: ThesisStatus;
    createdAt: string;
  };
  creator: {
    walletAddress: string;
    displayName: string | null;
  };
  market: {
    chainId: 8453;
    underlyingAsset: string;
    currentSpotPriceUsd: string | null;
    expiryAt: string;
    dataAsOf: string;
  };
  structure: {
    productType: string;
    isCall: boolean;
    isLong: boolean;
    strikesUsd: string[];
    collateralSymbol: string;
    contracts: string;
  };
  economics: {
    entryPremiumUsd: string | null;
    entryFeesUsd: string | null;
    maximumLossUsd: string | null;
    maximumPayoutUsd: string | null;
    breakEvenPricesUsd: string[];
    estimatedPnlUsd: string | null;
    finalPnlUsd: string | null;
    settlementPriceUsd: string | null;
  };
  verification: {
    transactionHash: string | null;
    optionAddress: string | null;
    confirmedOnchain: boolean;
  };
}
```

Money and quantity fields cross the interface as decimal strings to avoid floating-point ambiguity. The core product owns construction and validation of this object. The AI feature treats it as read-only.

### 10.4 Agent endpoints

Primary endpoint: `POST /api/agent/chat`.

Supporting endpoints:

- `GET /api/agent/conversations`
- `GET /api/agent/conversations/:id`
- `POST /api/agent/proposals/:id/approve`
- `POST /api/agent/proposals/:id/receipts`

Request:

```ts
interface AgentChatRequest {
  conversationId?: string;
  thesisId?: string;
  walletAddress?: `0x${string}`;
  messages: UIMessage[];
}
```

Behavior:

1. Validate the request.
2. Load any thesis context on the server using `thesisId`; never trust client-supplied financial values.
3. Enforce the applicable usage limit.
4. Treat creator text and prior messages as untrusted content, not instructions.
5. Run read tools automatically and require approval for every write-preparation tool.
6. Persist authenticated conversations, tool calls, proposals, RFQ key state, and transaction receipts.
7. Stream a safe error if the model, market source, or persistence layer is unavailable.

### 10.5 Required tool surface

Read-only tools: `searchTheses`, `getThesisContext`, `searchOptionBookOrders`, `getMarketData`, `previewOptionBookTrade`, `buildCustomRfqPreview`, `getRfqStatus`, `getRfqOffers`, and `getUserPositions`.

Approval-gated tools: `requestOptionBookExecution`, `requestRfqCreation`, and
`requestRfqCancellation`. These tools return prepared transactions; they never submit them.

**RFQ scope is deliberately thin (owner decision, 2026-09-05).** Create and cancel only, with
`convertToLimitOrder: true` so an unanswered request becomes a resting limit order rather than
idle capital. Offer decryption, offer monitoring, and settlement are out of scope for v1:
they require a database-backed `KeyStorageProvider` and a polling architecture whose value
depends on a market maker answering, which is unverified. OptionBook is the primary and demo
path; RFQ is secondary and must never be the critical path of a demonstration.

### 10.6 Initial answer format

The initial explanation should cover:

1. **What the creator believes.**
2. **What the option does.**
3. **How it can win or lose.**
4. **Maximum stated risk and important dates.**

If trusted values are missing, the assistant says they are unavailable instead of estimating them.

### 10.7 Suggested questions

- What needs to happen for this position to profit?
- What is the maximum loss?
- Explain the strikes in simple terms.
- What happens at expiry?
- How is the Counter side different?

### 10.8 Scope enforcement

The agent answers questions about this product only. Off-topic requests are declined and
redirected, never answered.

**In scope.** Options education and terminology, market and price questions for supported
assets, thesis discussion, live Thetanuts liquidity, trade previews and risk, the user's own
positions and P&L, and how this application works. Beginner explanations are explicitly in
scope: a first-time user asking what a put is must get a real answer.

**Out of scope.** General conversation, coding help, homework, other protocols and venues,
and any request unrelated to options or this product.

Enforcement is layered. Each layer alone is insufficient.

1. **Pre-model gate.** Every inbound message is classified before the primary model runs. A
   request classified out of scope returns a canned redirect and never reaches the primary
   model. This layer is authoritative and also bounds cost.
2. **Tool-grounded answering.** The agent's function is to call tools. When no tool serves a
   request, it declines rather than answering from parametric knowledge.
3. **System instruction.** States the scope boundary and the refusal format. Supporting
   layer only; it must never be the sole control.

Refusals redirect into the product rather than dead-ending, for example: "I only handle
options and theses here. Want me to show what is tradeable on ETH this week?"

Thesis text, comments, and display names are user-generated and enter model context as
untrusted data. Scope enforcement must hold when that content attempts to redirect the
agent. This is a required test case, not an aspiration.

## 11. Technical Architecture

### Web application

- Next.js App Router, React, TypeScript, and Tailwind.
- Server Components for read-heavy initial pages where practical.
- Client Components only for wallet interaction, live controls, and chat interaction.
- Route handlers or server actions own authenticated writes.

### Wallet and chain

- wagmi and viem.
- Base mainnet only (`chainId: 8453`).
- Coinbase Smart Wallet plus an owner-approved connector kit.
- The user wallet signs every approval and fill.

### Thetanuts

- Runtime dependency: `@thetanuts-finance/thetanuts-client`.
- Use OptionBook reads, preview, payout utilities, position/history reads, and external-wallet transaction encoding.
- Do not use the Thetanuts MCP package at runtime.
- Fetch fresh order data immediately before every fill and preserve API order fields verbatim.
- Order listing uses `client.api.fetchOrders()` and is filtered client-side. `filterOrders()`
  is unusable: it reads `response.orders` while the payload nests under `data.orders`, and the
  upstream worker ignores query parameters.
- No order stream exists. The SDK's configured WebSocket host does not resolve; poll on a
  20-30 second interval.
- Tradeable set for v1 is USDC-collateral orders with `isLong: false`, where the user takes the
  long side. Verified live on 2026-09-05: roughly 200 of 367 open Base mainnet orders, across
  BTC, ETH, BNB, SOL, AVAX and XRP.
- The book carries three product shapes, all USDC-collateralised and all tradeable: single-leg
  vanillas (which publish a `ticker`), multi-leg structures, and **binaries** published with a
  `name` such as "ETH 2460 Up 1D" and `type: "binaries"`. Binaries express a directional view
  on a level by a date, which is the same shape as a thesis, and are the easiest product to
  explain to a first-time user. One live snapshot held 139 vanilla, 37 multi-leg and 25 binary.
- Structured products omit `ticker`. Resolve their underlying from `priceFeed`, using the
  mapping learned from the vanillas in the same snapshot rather than a hardcoded table.
- `availableAmount` is the maker's collateral budget, not a contract count. Contract sizing
  must always come from `previewFillOrder`.
- Position read-back after a fill is asynchronous: call `api.triggerIndexerUpdate()` and poll.
- The seven `PHYSICAL_*` multi-leg implementations are not deployed on Base. The agent's
  product menu must exclude them.

### Database

- Hosted Supabase project `-nuts` (AWS ap-northeast-1), shared by both developers. Hosting is Vercel.
- Schema changes ship as drizzle migrations, never `drizzle-kit push`. `push` reshapes the database to match the schema of whoever runs it and can drop the other developer's tables.
- Each developer owns their own tables. The AI track owns the `agent_*` tables; the core product owns users, theses, positions, follows, comments and activity. Both export from `packages/db/src/schema/index.ts`.
- The app connects through Supabase's transaction pooler; migrations use the direct connection.
- PostgreSQL with Drizzle.
- Database stores social state and an indexed record of app-originated transactions.
- Server-only access through `@nuts/db`.
- Onchain state overrides conflicting database financial state.

### AI

- Server-side model invocation with streamed responses.
- Provider credentials remain server-only.
- Model provider is replaceable; product behavior is defined by the context contract and guardrails, not a specific vendor.

## 12. Minimum Data Model

### `users`

- Internal ID.
- Unique normalized wallet address.
- Optional display name, bio, and avatar.
- Created and updated timestamps.

### `auth_challenges`

- Wallet address.
- Single-use nonce.
- Domain and chain ID.
- Expiration and consumed timestamp.

### `theses`

- Internal ID and creator user ID.
- Headline and rationale.
- Direction and lifecycle status.
- Underlying asset and expiry.
- Product type, call/put and long/short flags, strikes, and collateral metadata.
- Immutable creator order snapshot.
- Creator position ID once confirmed.
- Created, published, expired, and settled timestamps.

### `positions`

- Internal ID, thesis ID, and user ID.
- Role: creator or participant.
- Side: Back or Counter.
- Chain ID and wallet address.
- Order identifier/hash and immutable order snapshot.
- Transaction hash, option address, and referrer.
- Budget, contracts, premium, fees, collateral, and deterministic payoff values.
- Pending, confirmed, indexed, expired, settled, or failed status.
- Settlement and final P&L values when available.
- Created, confirmed, indexed, and settled timestamps.

Transaction hash plus chain ID must be unique. A public thesis must reference exactly one confirmed creator position.

### `comments`, `follows`, and `activity`

Conventional social relationships tied to users and theses. Activity records references to confirmed domain events; it does not replace the underlying record.

## 13. Error and Edge-Case Requirements

- **Wrong chain:** block financial actions and offer Base switch.
- **Disconnected wallet:** retain non-sensitive draft UI state and request connection.
- **Rejected signature:** leave the user in control and show a non-alarming cancellation state.
- **Insufficient balance:** block submission with required versus available amounts.
- **Insufficient allowance:** request only the needed owner-approved allowance strategy.
- **Stale or filled order:** refetch, stop execution, and require a new manual selection.
- **Changed preview:** show the new economics and require confirmation again.
- **Failed transaction:** do not publish or count the position.
- **Confirmed but not indexed:** show syncing and retry position reads after the documented delay.
- **Expired but unsettled:** show settlement pending; do not invent final P&L.
- **Indexer disagreement:** display chain-confirmed transaction state and retry indexed enrichment.
- **AI unavailable:** preserve the financial product and show a retryable explanation error.
- **Prompt injection in thesis text:** treat all creator content as quoted data and ignore embedded instructions.
- **Missing AI context:** explicitly identify unavailable values.

## 14. Safety and Trust Requirements

- Never collect, transmit, log, or request private keys or seed phrases.
- Never publish an unconfirmed position as Backed Onchain.
- Never label an estimate as settled P&L.
- Always show the participant's own preview rather than the creator's economics at execution.
- Refresh the selected order before building calldata. OptionBook order signatures are
  short-lived: makers re-sign the book roughly every 60 seconds, and the remaining validity
  of any order fetched at random was measured between 59 and 113 seconds on 2026-09-05.
  Treat the window as under one minute. Collateral approval must complete before order
  selection; calldata must be built and broadcast within 30 seconds of the fetch that
  produced it. The instrument persists across re-signing while the price drifts, so a
  visible price-drift tolerance is required.
- Simulate every write with the SDK `callStatic*` family before returning calldata to the
  client, so a chain-level failure surfaces as a server error rather than a wallet revert.
- Enforce agent spend and loss limits outside the model process. A limit expressed only as a
  system instruction or an in-process check is not a spend control.
- Verify transaction chain, recipient contract, function, and receipt before persistence.
- Keep model API keys, database credentials, and RPC credentials server-only.
- Escape and sanitize user-generated content.
- Include clear risk language without presenting the application as guaranteeing profit.

## 15. Team Ownership and Integration Contract

### Core product developer

Owns:

- Database schema and migrations.
- Wallet connection and signed-message authentication.
- Thesis, feed, profile, portfolio, and social UI.
- Thetanuts order discovery, deterministic calculations, previews, approvals, fills, positions, and settlement.
- `ThesisAiContext` construction and validation.
- Core loading, failure, and syncing states.

### AI agent developer

Owns:

- AI provider integration and server-side streaming.
- `/api/agent/*` request validation, streaming, persistence, and rate limiting.
- `/agent` discovery/context workspace and transaction approval UI.
- Thetanuts read tools and deterministic transaction preparation for OptionBook and RFQ.
- System instructions, context formatting, prompt-injection resistance, and safety behavior.
- AI-specific tests and evaluation fixtures.
- Graceful model failure and missing-context behavior.

### Shared checkpoints

1. Agree and export the shared thesis domain types before parallel feature work.
2. Core developer provides a fixture and server function matching `ThesisAiContext`.
3. AI developer builds against the fixture without duplicating financial calculations.
4. Replace the fixture with the server function without changing the AI contract.
5. Run joint acceptance tests against an open, expired, settled, and partially missing thesis.

Neither developer changes the shared contract without notifying the other and updating this PRD.

## 16. Acceptance Criteria

### Core product

- A wallet can connect, prove ownership, and switch to Base.
- Available markets come from live Thetanuts data.
- A creator can manually select an order and preview a budget.
- The preview clearly shows bounded risk and expiry.
- A creator can approve collateral and complete a real small Base mainnet fill.
- A thesis is published only after receipt verification.
- A second wallet can complete a participant fill from the thesis page.
- Both positions appear in their respective portfolios.
- Expired and settled positions display the correct state without premature final P&L.

### AI companion

- Explain this thesis opens from feed and detail surfaces.
- The first response explains the thesis, structure, win/loss conditions, risk, and expiry.
- Follow-up questions retain relevant conversational context.
- Every financial value comes from the trusted context object.
- Missing values are acknowledged rather than estimated.
- Creator text cannot override system safety instructions.
- No AI path can sign or submit a transaction.
- Every prepared transaction satisfies the safety contract and is explicitly approved before the wallet prompt.
- The agent can complete one owner-approved, small Base mainnet OptionBook trade in the demo environment.
- Model failure does not block viewing or trading the thesis.

## 17. Hackathon Demo Script

1. Open the live feed and show that markets originate from current Thetanuts liquidity.
2. Connect the creator wallet on Base.
3. Select an available structure, enter a thesis and small budget, and show the payoff preview.
4. Approve and fill the real OptionBook order.
5. Show the confirmed transaction and Backed Onchain thesis.
6. Open Explain this thesis and ask what must happen for the position to win.
7. Connect a second wallet and preview a Back or Counter position using current liquidity.
8. Execute the participant transaction.
9. Show both onchain records, portfolio entries, and the creator's verifiable history.

## 18. Locked Decisions

- Product name: Thesis.fun.
- Base mainnet only.
- Every supported asset is discovered from live Thetanuts orders; no fixed asset list.
- Thetanuts client SDK is used directly at runtime.
- Creators and participants manually select orders and budgets.
- Wallet address is the v1 identity.
- Users sign every financial transaction.
- AI is an approval-gated trading agent; the user's wallet remains the sole execution authority.
- No Thetanuts MCP runtime dependency.
- Deterministic code, not AI, owns financial calculations.

## 19. Owner Decisions Still Required

Do not invent these values or policies:

- Platform referrer address and any fee policy.
- Risk acknowledgement wording and any default budget or allowance behavior.
- Trending formula and time windows.
- Leaderboard formula and minimum eligibility.
- Creator verification thresholds beyond transaction confirmation.
- Comment, profile, and thesis content limits.
- Production model budget above the v1 default rate limits.
- Final connector-kit choice.

These decisions should be added to this PRD when approved.

## 20. References

- Thetanuts SDK: https://docs.thetanuts.finance/sdk
- OptionBook overview: https://docs.thetanuts.finance/for-builders/overview
- Fetching orders: https://docs.thetanuts.finance/for-builders/fetching-orders
- Executing trades: https://docs.thetanuts.finance/for-builders/executing-trades
- Positions and history: https://docs.thetanuts.finance/for-builders/positions-and-history
- Payouts and pricing: https://docs.thetanuts.finance/for-builders/payouts-and-pricing-intuition
- Troubleshooting: https://docs.thetanuts.finance/for-builders/troubleshooting
