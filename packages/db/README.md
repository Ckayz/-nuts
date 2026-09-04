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

All onchain quantities are stored as unconstrained `numeric` integer strings in base units, with database checks rejecting fractional values instead of rounding them. Each quantity or same-unit array has an adjacent decimals column that is required to interpret it. Never convert these values through JavaScript `number`.

USD display values use Postgres `numeric` and cross application interfaces as decimal strings. A missing trusted value stays `null`; it is never estimated. `order_snapshot` and `creator_order_snapshot` retain immutable, lossless string-encoded, versioned `OrderWithSignature` JSON. `fill_event` does the same for receipt fields; `indexer_position_id` is nullable until indexed.

Wallet addresses are normalized to lowercase before persistence. Database checks enforce lowercase values in `users`, `auth_challenges`, and `positions`.

Constraint triggers fence every referenced creator position to the same thesis and creator, creator role, Base mainnet, a confirmed lifecycle status, and a non-null confirmation timestamp. Raw SQL writers must explicitly maintain `users.updated_at`; Drizzle updates apply its `$onUpdate` callback.

The position wallet must also equal the creator user's wallet. A deferred user-wallet trigger rejects a changed wallet while that user has an open, expired, or settled thesis (same-value updates are allowed). This is the simpler rejection policy requested in round 3, rather than reassigning historic positions.

`positions.chain_id` and `auth_challenges.chain_id` must be 8453. Confirmed, indexed, expired, and settled positions require a non-null `fill_event` with version 1; write it through `encodeFillEventSnapshot`. SQL NULL, a missing version, and JSON null cannot satisfy the check.

Contracts must be positive integers. All decimals columns must be non-negative. Each nullable base-unit quantity requires its decimals when the quantity is present. Round 3 covers these columns:

- `positions`: `contracts`; `budget_decimals`, `contract_decimals`, `premium_decimals`, `fee_decimals`, `collateral_decimals`, `break_even_price_decimals`; `maximum_loss` / `maximum_loss_decimals`, `maximum_payout` / `maximum_payout_decimals`, `estimated_pnl` / `estimated_pnl_decimals`, `settlement_price` / `settlement_price_decimals`, `payout` / `payout_decimals`, `final_pnl` / `final_pnl_decimals`; `break_even_prices`.
- `theses`: `strike_decimals`, `collateral_decimals`, `strikes`.

Strikes and base-unit break-even arrays reject null elements, multidimensional arrays, fractional elements, and negative elements. Strikes must be non-empty; an empty break-even array remains valid. The dimension guard uses `CASE` so PostgreSQL never calls the one-dimensional `array_position` function on a multidimensional input.

`BEFORE UPDATE` triggers reject changes to `theses.creator_order_snapshot` and `positions.order_snapshot` using `IS DISTINCT FROM`; identical JSON values and updates to other columns are allowed. New trigger functions use qualified `public` table references and pin `search_path = pg_catalog, public`.

Activity must reference a thesis or position. Follow-up: activity lifecycle validation against confirmed domain events remains the application writer's responsibility; lifecycle triggers are outside round 3's scope.

## Migrations

Generate migrations from this package:

```bash
cd packages/db
bunx drizzle-kit generate
bunx drizzle-kit check
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

Migrations `0004_boring_gorilla_man` (generated checks) and `0005_wallet-and-snapshot-invariants` (hand-written functions/triggers) follow round 2's `0003`; both are recorded in `src/migrations/meta/_journal.json`. Existing rows must satisfy the new checks before migration can succeed. No backfill values are invented here.

After applying migrations, run `DATABASE_URL='<intended-test-postgres-url>' bun test test/schema.integration.test.ts`. Each integration case seeds its own transaction and rolls it back. Without `DATABASE_URL`, the file emits one skipped test. The isolated trigger tests temporarily drop the overlapping Base CHECK or creator-position FK inside their rollback transaction to prove the trigger itself rejects the invalid relationship. Use a test database whose role owns these tables.

## AI teammate handoff

`src/ai-context.ts` exports the exact PRD §10.2 `ThesisAiContext`, `ThesisDirection`, and `ThesisStatus` types, the `thesisAiContextSchema` validator, and the pure `buildThesisAiContext` row mapper. It performs representation conversion only and never calls the SDK or calculates financial values.

Four offline examples—open, expired, settled, and partially missing—are exported from `src/fixtures/thesis-ai-context.example.ts`. The exact PRD contract requires a non-null `structure.contracts`, so `buildThesisAiContext` rejects a missing position while `buildThesisAiContextOrUnavailable` returns an explicit unavailable result. `TODO-OWNER`: the owner and AI teammate must coordinate the draft/pending product behavior under PRD §15 without changing the shared context object.
