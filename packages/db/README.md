# `@nuts/db`

The database is the application index and social layer for Thesis.fun. Onchain state remains authoritative for transactions, ownership, and settlement.

## Tables

- `users`: normalized wallet identities and optional public profiles.
- `auth_challenges`: expiring, single-use wallet-sign-in nonces.
- `theses`: thesis content, market structure, immutable creator order snapshot, and creator-position link.
- `positions`: creator and participant fills, immutable order snapshots, transaction lifecycle, economics, and settlement.
- `comments`: user comments on theses.
- `follows`: directed user-to-user follows.
- `activity`: references to confirmed domain events and their underlying thesis or position records.

## Unit conventions

All onchain quantities are stored as `numeric(78,0)` integer strings in base units. Each quantity or same-unit array has an adjacent decimals column that is required to interpret it. This includes contracts, budget, premium, fees, collateral, strikes, deterministic payoff values, settlement price, payout, and P&L. Never convert these values through JavaScript `number`.

USD display values use Postgres `numeric` and cross application interfaces as decimal strings. A missing trusted value stays `null`; it is never estimated. `order_snapshot` and `creator_order_snapshot` retain immutable raw `OrderWithSignature` JSON.

Wallet addresses are normalized to lowercase before persistence. Database checks enforce lowercase values in `users`, `auth_challenges`, and `positions`.

## Migrations

Generate migrations from this package:

```bash
cd packages/db
bunx drizzle-kit generate
```

Apply migrations to the local database by providing its URL:

```bash
cd packages/db
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres bunx drizzle-kit migrate
```

Apply to production only with the intended production URL explicitly supplied. Git pushes do not migrate the database:

```bash
cd packages/db
DATABASE_URL='<production-postgres-url>' bunx drizzle-kit migrate
```

## AI teammate handoff

`src/ai-context.ts` exports the exact PRD §10.2 `ThesisAiContext`, `ThesisDirection`, and `ThesisStatus` types, the `thesisAiContextSchema` validator, and the pure `buildThesisAiContext` row mapper. It performs representation conversion only and never calls the SDK or calculates financial values.

Four offline examples—open, expired, settled, and partially missing—are exported from `src/fixtures/thesis-ai-context.example.ts`. The AI companion treats these objects as read-only. The exact PRD contract requires a non-null `structure.contracts`, so the builder rejects a missing creator-position row rather than inventing a value.
