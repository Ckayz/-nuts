# Thesis.fun Product Requirements Document

**Version:** 1.0  
**Status:** Active source of truth  
**Last updated:** 2026-09-05  
**Primary hackathon track:** Best Product Built on the Thetanuts SDK

## 1. Product Summary

Thesis.fun is a social options platform where market opinions are backed by real onchain positions on Thetanuts, executed on Base mainnet.

A creator publishes a market thesis, manually selects a compatible live option structure, commits their own capital, and signs the transaction. Other users can inspect the thesis, see its bounded payoff and risk, and either back or counter it with their own independently previewed and signed Thetanuts position. Creator performance and participant P&L are tied to verifiable onchain transactions.

The AI companion helps users understand a thesis and its option structure. It does not select, size, recommend, encode, sign, or execute trades.

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
5. Explain option payoff and risk in plain language without delegating financial decisions to AI.
6. Complete at least one end-to-end Base mainnet creator trade and one participant trade for the hackathon demo.

### 3.2 Non-goals for v1

- Guaranteed returns, profit promises, or personalized financial advice.
- Autonomous or AI-selected trading.
- AI position sizing, order selection, transaction construction, or execution.
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

The v1 AI companion does not qualify for the AI agent track because it does not place a trade. This is intentional. Entering that track requires an owner-approved scope change and a separate user-approved execution design; it must not be added implicitly.

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
3. **Users make the decision.** Users manually select a side, structure, and budget.
4. **AI explains; deterministic code calculates.** The SDK and application logic own financial values.
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

### 8.6 Explain with AI

1. User selects **Explain this thesis** from a feed card or thesis page.
2. The app opens a companion panel with the current trusted thesis context.
3. The AI provides a concise initial explanation.
4. User can ask follow-up questions.
5. The companion cites the values it used and labels their timestamp/status.
6. Trading remains a separate manual interface outside the conversation.

## 9. Functional Requirements

### 9.1 P0 — Hackathon-critical

- Base mainnet wallet connection and wallet-signature authentication.
- Live OptionBook discovery with no hardcoded market list.
- Manual order selection and budget input.
- Deterministic fill preview and risk display.
- Collateral allowance check and approval.
- User-signed OptionBook fill using the Thetanuts SDK's external-wallet calldata path.
- Transaction receipt verification and position persistence.
- Thesis creation gated by the creator's confirmed transaction.
- Feed, thesis detail, create flow, and portfolio.
- Open, expired, syncing, failed, and settled states.
- AI explanation panel using trusted server-side context.
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

## 10. AI Companion Specification

### 10.1 Responsibilities

The AI companion may:

- Summarize the creator's thesis.
- Explain the option structure and each strike.
- Explain how the position can make or lose money.
- Explain maximum loss, maximum payout, break-even values, and expiry when supplied by trusted calculations.
- Compare Back and Counter conceptually without recommending one.
- Explain current versus settled P&L.
- Answer beginner follow-up questions.

The AI companion must not:

- Select or rank trades for the user.
- Recommend Back or Counter.
- Generate a position size or budget.
- Claim a probability of profit unless a trusted deterministic value is explicitly supplied and labeled.
- Calculate authoritative prices, payout, P&L, or risk from scratch.
- Build transaction calldata.
- Request a signature or invoke a wallet.
- Access private keys, seed phrases, or unrestricted wallet permissions.
- Promise or imply guaranteed profit.

### 10.2 Shared context contract

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

### 10.3 AI endpoint

`POST /api/ai/explain`

Request:

```ts
interface ExplainThesisRequest {
  thesisId: string;
  question: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}
```

Behavior:

1. Validate the request.
2. Load the thesis context on the server using `thesisId`; never trust client-supplied financial context.
3. Treat creator text and prior messages as untrusted content, not instructions.
4. Send the trusted context and bounded conversation to the configured model.
5. Stream a text response.
6. Return a safe error if the model or context is unavailable.
7. Do not store conversations in v1 unless the owner explicitly adds that requirement.

### 10.4 Initial answer format

The initial explanation should cover:

1. **What the creator believes.**
2. **What the option does.**
3. **How it can win or lose.**
4. **Maximum stated risk and important dates.**

If trusted values are missing, the assistant says they are unavailable instead of estimating them.

### 10.5 Suggested questions

- What needs to happen for this position to profit?
- What is the maximum loss?
- Explain the strikes in simple terms.
- What happens at expiry?
- How is the Counter side different?

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

### Database

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
- Refresh the selected order before building calldata.
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

### AI companion developer

Owns:

- AI provider integration and server-side streaming.
- `/api/ai/explain` request validation and response behavior.
- Explanation panel and follow-up conversation UI.
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
- No AI path can invoke wallet, SDK write, or transaction functionality.
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
- AI is an explanation companion only.
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
- AI provider, model, rate limits, and usage budget.
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
