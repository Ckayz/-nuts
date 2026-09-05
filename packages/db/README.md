# `@nuts/db`

The database is the application index and social layer for Thesis.fun. Onchain state remains authoritative for transactions, ownership, and settlement.

## Tables

- `users`: normalized wallet identities and optional public profiles.
- `auth_challenges`: expiring, single-use wallet-sign-in nonces.
- `theses`: required post text, optional market tag, optional complete structure and immutable order snapshot, and optional creator-position link.
- `positions`: creator and participant fills, immutable order snapshots, transaction lifecycle, economics, and settlement.
- `comments`: user comments on theses.
- `follows`: directed user-to-user follows.
- `likes`: user/thesis foreign keys, composite primary key `(user_id, thesis_id)`, and `created_at` defaulting to now().
- `activity`: references to confirmed domain events and their underlying thesis or position records.

## Post model

A thesis is a post. Headline is required and rationale is optional. `open` means published, whether backed or unbacked. A confirmed and validated creator position earns the verified badge; no position is required to publish.

`theses_structure_all_or_nothing` requires direction, underlying asset, expiry, product type, call/put and long/short flags, strikes, strike decimals, collateral address/symbol/decimals, and creator order snapshot to be either all NULL or all non-NULL. Direction belongs to the optional structure: PRD §8.2 derives it from the selected order and §12 now states this explicitly. The strikes CHECK permits SQL NULL for absent structures but retains all existing array validation when present.

`tagged_asset` is an independent nullable market tag. `theses_tagged_asset_uppercase` requires uppercase; `theses_tagged_asset_matches_structure` requires a non-NULL matching tag whenever a structure is present. Migration 0003 copies existing underlying assets into the new tag before adding the checks; it invents no market values. Existing non-uppercase underlying assets will fail the new checks and require explicit data reconciliation, not silent normalization.

`theses_backing_requires_structure` replaces the public backing requirement: a non-NULL creator-position link requires a structure. All existing link uniqueness, confirmation, ownership, wallet, role and chain fences remain. Unbacked public posts do not fence wallet changes. Snapshot immutability is unchanged, including NULL-to-value changes: adding a structure to an existing text-only post is rejected by the existing snapshot trigger. This round does not introduce an editing/backing workflow.

## Unit conventions

All onchain quantities are stored as unconstrained `numeric` integer strings in base units, with database checks rejecting fractional values instead of rounding them. Each quantity or same-unit array has an adjacent decimals column that is required to interpret it. Never convert these values through JavaScript `number`.

USD display values use Postgres `numeric` and cross application interfaces as decimal strings. A missing trusted value stays `null`; it is never estimated. `order_snapshot` and `creator_order_snapshot` retain immutable, lossless string-encoded, versioned `OrderWithSignature` JSON. `fill_event` does the same for receipt fields; `indexer_position_id` is nullable until indexed.

Wallet addresses are normalized to lowercase before persistence. Database checks enforce lowercase values in `users`, `auth_challenges`, and `positions`.

On thesis writes and referenced-position updates or deletes, constraint triggers fence every referenced creator position to the same thesis and creator, creator role, Base mainnet, a confirmed lifecycle status, and a non-null confirmation timestamp. Thesis validation self-assigns the linked position's `status` and updates the creator user's `updated_at` as guard-row writes. Other raw SQL writers must explicitly maintain `users.updated_at`; Drizzle updates apply its `$onUpdate` callback.

Those validations also require the position wallet to equal the creator user's wallet. A deferred user-wallet trigger validates the final wallet against linked positions while that user has an open, expired, or settled thesis with a non-NULL creator-position link (same-value updates and intermediate changes restored before validation are allowed). Draft, pending, and cancelled theses may retain a linked position after a later user-wallet change; the user-wallet trigger does not fence those statuses. The AI availability wrapper returns `not_published` for drafts and cancelled theses; the strict builder rejects a wallet mismatch with `POSITION_MISMATCH`. For pending theses with a mismatched position, the wrapper returns `invalid_position`.

`positions.chain_id` and `auth_challenges.chain_id` must be 8453. Confirmed, indexed, expired, and settled positions require a non-null `fill_event` with version 1; write it through `encodeFillEventSnapshot`. SQL NULL, a missing version, and JSON null cannot satisfy the check.

Contracts must be positive integers. All decimals columns must be non-negative. Each nullable base-unit quantity requires its decimals when the quantity is present. Round 3 covers these columns:

- `positions`: `contracts`; `budget_decimals`, `contract_decimals`, `premium_decimals`, `fee_decimals`, `collateral_decimals`, `break_even_price_decimals`; `maximum_loss` / `maximum_loss_decimals`, `maximum_payout` / `maximum_payout_decimals`, `estimated_pnl` / `estimated_pnl_decimals`, `settlement_price` / `settlement_price_decimals`, `payout` / `payout_decimals`, `final_pnl` / `final_pnl_decimals`; `break_even_prices`.
- `theses`: `strike_decimals`, `collateral_decimals`, `strikes`.

Strikes and base-unit break-even arrays reject null elements, multidimensional arrays, fractional elements, and negative elements. Strikes must be non-empty; an empty break-even array remains valid. The dimension guard uses `CASE` so PostgreSQL never calls the one-dimensional `array_position` function on a multidimensional input.

`BEFORE UPDATE` triggers reject changes to `theses.creator_order_snapshot` and `positions.order_snapshot` using `IS DISTINCT FROM`; identical JSON values and updates to other columns are allowed. New trigger functions use qualified `public` table references and pin `search_path = pg_catalog, public`.

Activity must reference a thesis or position. Follow-up: activity lifecycle validation against confirmed domain events remains the application writer's responsibility; lifecycle triggers are outside round 3's scope.

## Migrations

The chain is rebased onto the AI track's migration, which is already applied to the production Supabase database:

- `0000_agent_tables` — the AI track's six `agent_*` tables (`docs/HANDOVER.md` §4). Restored byte-identically from `origin/main`; already applied to production. Never regenerate or edit it.
- `0001_core_schema` — generated from `src/schema`: the five enums, the seven core tables with their generated checks, the foreign keys, and the unique indexes.
- `0002_core_triggers` — hand-written: three `plpgsql` trigger functions and the five triggers they back (the creator-position invariant on `theses` and `positions`, the public-creator wallet invariant on `users`, and the two order-snapshot immutability triggers). Drizzle does not model functions or triggers, so this migration has no snapshot of its own.
- `0003_thesis_is_a_post` — generated schema changes for optional structures/backing and likes, with a derived `tagged_asset = underlying_asset` data backfill inserted before the new tag checks.
- `0004_unbacked_wallet_fence` — hand-written replacement of the public creator-wallet function, excluding NULL links from its existing validation. Non-NULL link predicates and lock order are preserved.

`0000`–`0002` are frozen. Apply the full migration chain before using the post model.

Why the chain was rebased: drizzle-orm's migrator reads only the single most recently applied row (`order by created_at desc limit 1`) and applies a journal entry when `lastDbMigration.created_at < migration.folderMillis` (`drizzle-orm/pg-core/dialect.js`). It never compares tags or hashes. Our original chain carried `when` timestamps *earlier* than the already-applied `0000_agent_tables`, so every one of our migrations would have been skipped silently against production — reporting success while changing nothing. Any migration added from here must carry a `when` greater than every applied entry. `bunx drizzle-kit generate` does this automatically; a hand-written journal entry must be given a fresh `Date.now()`.

Generate migrations from this package:

```bash
cd packages/db
bunx drizzle-kit generate
bunx drizzle-kit check
```

The config chooses `DIRECT_DATABASE_URL` before `DATABASE_URL`. The shared env loader reads `.env.local` before `.env` (including `apps/web`), with explicit process environment taking precedence. Setting only `DATABASE_URL` does not override a loaded `DIRECT_DATABASE_URL`. Every migrate invocation, including after a local reset, must explicitly set both URLs to the intended target. The config prints `drizzle-kit target: <host>:<port>/<db>` to stderr without credentials. Hosts other than `127.0.0.1` and `localhost` require `DRIZZLE_ALLOW_REMOTE=1`; inspect the printed target before proceeding.

Apply migrations to the local database by providing both URLs:

```bash
cd packages/db
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
DIRECT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
bunx drizzle-kit migrate
```

Apply to production only with `drizzle-kit migrate` and the intended production URL explicitly supplied. Git pushes do not migrate the database:

```bash
cd packages/db
DATABASE_URL='<production-direct-postgres-url>' \
DIRECT_DATABASE_URL='<production-direct-postgres-url>' \
DRIZZLE_ALLOW_REMOTE=1 bunx drizzle-kit migrate
```

Never run `drizzle-kit push` (or `bun run db:push`) against the shared Supabase project. `push` reshapes the database to match the schema of whoever runs it, so a tree missing the other developer's tables can drop them; and because Drizzle does not model functions or triggers, `push` would never apply the `0002_core_triggers` layer at all. `push` is for a local throwaway database and nowhere else.

Existing rows must satisfy the checks in `0001_core_schema` before migration can succeed. No backfill values are invented here.

After applying migrations, run `DATABASE_URL='<intended-test-postgres-url>' bun test test/schema.integration.test.ts`. Each integration case seeds its own transaction and rolls it back. Without `DATABASE_URL`, the file emits one skipped test. The isolated trigger tests temporarily drop the overlapping Base CHECK or creator-position FK inside their rollback transaction to prove the trigger itself rejects the invalid relationship. Use a test database whose role owns these tables. Run `DATABASE_URL='<intended-test-postgres-url>' bun test test/schema.concurrency.test.ts` for the two-connection publication/status and publication/wallet races in both orders under READ COMMITTED, REPEATABLE READ and SERIALIZABLE, plus stale snapshots whose mutations start after publication commits. These tests commit unique fixtures and delete them in cleanup, observe blocking with `pg_blocking_pids`, and set a statement timeout on both connections. Without `DATABASE_URL`, the concurrency file also emits one skipped test.

## Commit-time blocking and retries

Deferred creator validation runs at COMMIT unless constraints are made immediate earlier. A conflicting writer blocks until the transaction holding the row lock commits or rolls back. Thesis validation locks the user and linked position `FOR NO KEY UPDATE`, re-reads the current thesis `FOR SHARE`, and writes the guard rows, so a REPEATABLE READ or SERIALIZABLE writer with an older snapshot conflicts with the write even if it cannot see the published thesis. Deferred thesis, position and wallet events validate current rows, allowing intermediate invalid states restored before validation.

Deployments must set server-side `lock_timeout` and `statement_timeout`; both values are `TODO-OWNER`. The client in `src/index.ts` supplies neither timeout. Explicit trigger validation locks follow users → positions → theses, with multiple rows sorted by ID within each table. The publication branch takes guard-write locks before locking theses. Caller DML and foreign-key locks may already be held, so this order does not eliminate deadlocks. SQLSTATE `40P01` (deadlock) and `40001` (serialization failure) both abort the transaction and must be retried by the application. A timeout also aborts the whole transaction; the application must roll it back and retry the entire transaction from the beginning, not just COMMIT or the failing statement. The concurrency tests' timeouts bound test execution and are not deployment policy.

## AI teammate handoff

`src/ai-context.ts` exports the exact PRD v2.0 §10.3 `ThesisAiContext`, `ThesisDirection`, and `ThesisStatus` types, the `thesisAiContextSchema` validator, and the pure `buildThesisAiContext` row mapper. It performs representation conversion only and never calls the SDK or calculates financial values.

Four offline context examples—open, expired, settled, and partially missing—are exported from `src/fixtures/thesis-ai-context.example.ts`. The exact PRD contract requires a non-null `structure.contracts`, so `buildThesisAiContext` rejects a missing position while `buildThesisAiContextOrUnavailable` returns an explicit unavailable result. `TODO-OWNER`: the owner and AI teammate must coordinate the draft/pending product behavior under PRD §15 without changing the shared context object.

Post row fixtures in `src/fixtures/thesis-post.example.ts` provide text-only and market-tagged unbacked examples. Before any other availability checks, a missing structure returns `no_structure`; the strict builder throws `NO_STRUCTURE`. A complete structure without a position retains `no_creator_position` / `NO_CREATOR_POSITION`. The shared `ThesisAiContext` type is unchanged.

Round-7 test changes: the former integration case `public thesis requires creator position` is replaced by `open unbacked structured thesis accepted`. Existing structured SQL fixtures now supply the matching `tagged_asset`; the AI row fixture does likewise. Other prior integration expectations are unchanged. Concurrency failure outcomes record mutation/validation/commit phase, with stale-snapshot publication-first failures expected at mutation; its invalid-state query now checks linked theses only. Live migration, integration and concurrency checks must be run by the orchestrator.
