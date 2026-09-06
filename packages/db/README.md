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
- `activity`: references to confirmed domain events and their underlying thesis, position, or followed-user records.

## Post model

A thesis is a post. Headline is required and rationale is optional. `open` means published, whether backed or unbacked. A confirmed and validated creator position earns the verified badge; no position is required to publish.

`theses_structure_all_or_nothing` requires direction, underlying asset, expiry, product type, call/put and long/short flags, strikes, strike decimals, collateral address/symbol/decimals, and creator order snapshot to be either all NULL or all non-NULL. Direction belongs to the optional structure: PRD §8.2 derives it from the selected order and §12 now states this explicitly. The strikes CHECK permits SQL NULL for absent structures but retains all existing array validation when present.

`tagged_asset` is an independent nullable market tag. `theses_tagged_asset_uppercase` requires uppercase; `theses_tagged_asset_matches_structure` requires a non-NULL matching tag whenever a structure is present. Migration 0003 copies existing non-NULL underlying assets only into NULL tags before adding the checks. Within the migration transaction, it disables only `theses_creator_position_invariant` around that single UPDATE and immediately re-enables it, preserving round-6-permitted linked drafts whose creator later changed wallets without queuing relationship validation for the tag backfill; it invents no market values. Existing non-uppercase underlying assets will fail the new checks and require explicit data reconciliation, not silent normalization.

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

Activity must reference a thesis, position, or target user. `user_id` is the actor; nullable `target_user_id` references the followed user for a `follow` event. The `(target_user_id, created_at desc)` index supports target activity reads. Follow inserts record activity in the follow transaction; retries and unfollows add no event, and unfollow retains the historical event. Follow-up: activity lifecycle validation against confirmed domain events remains the application writer's responsibility; lifecycle triggers are outside round 3's scope.

## Migrations

The chain is rebased onto the AI track's migration, which is already applied to the production Supabase database:

- `0000_agent_tables` — the AI track's six `agent_*` tables (`docs/HANDOVER.md` §4). Restored byte-identically from `origin/main`; already applied to production. Never regenerate or edit it.
- `0001_core_schema` — generated from `src/schema`: the five enums, the seven core tables with their generated checks, the foreign keys, and the unique indexes.
- `0002_core_triggers` — hand-written: three `plpgsql` trigger functions and the five triggers they back (the creator-position invariant on `theses` and `positions`, the public-creator wallet invariant on `users`, and the two order-snapshot immutability triggers). Drizzle does not model functions or triggers, so this migration has no snapshot of its own.
- `0003_thesis_is_a_post` — generated schema changes for optional structures/backing and likes, with a derived `tagged_asset = underlying_asset` data backfill inserted before the new tag checks.
- `0004_unbacked_wallet_fence` — hand-written replacement of the public creator-wallet function, excluding NULL links from its existing validation. Non-NULL link predicates and lock order are preserved. This hand-written migration has no snapshot.
- `0005_slugs_and_handles` — adds required unique thesis slugs with deterministic backfill and optional unique user handles.
- `0006_follow_activity` — adds nullable target-user FK and target/time index; drops and recreates `activity_domain_reference_required` with the same name to accept target-only events.
- `0007_standalone_positions` — a trade is independent of a post (owner 2026-09-05): `positions.thesis_id` becomes nullable, `position_role` gains `standalone`, and CHECK `positions_thesis_role_consistent` ties the two (`thesis_id IS NULL` exactly when `role = 'standalone'`; compared as `role::text` because an enum value added in the same transaction cannot be used there). The frozen 0002 trigger still requires `role = 'creator'` for `theses.creator_position_id`, so a standalone position can never be linked as a creator position.

- `0008_trade_recording_fences` — trade recording fences (2026-09-05): `positions.ticket_hash` and `positions.failure_reason` are added; the `(chain_id, tx_hash)` unique index becomes PARTIAL (`WHERE status <> 'failed'`) so a refused or reverted recording marked `failed` never blocks the real taker's hash; CHECK `positions_failure_reason_only_when_failed` (`failure_reason IS NULL OR status = 'failed'`). Snapshot `0008_snapshot.json`.
- `0009_market_thesis_index` — generated (teammate, 2026-09-06): one additive index, `CREATE INDEX "theses_tagged_asset_created_at_idx" ON "theses" USING btree ("tagged_asset","created_at")`, for the per-market thesis reads. No table, column or constraint changes. Snapshot `0009_snapshot.json`.

`0000`–`0009` are frozen — ten entries in `meta/_journal.json`, measured 2026-09-06 06:56. Apply the full migration chain before using the post model. Production holds the same `0000`–`0009` — 10 rows, measured 2026-09-06 06:57 through the session pooler (it held `0000`–`0008` at 01:31; `0009` was applied at 06:57). The runbook is `docs/DEPLOY.md`; because a push to `main` auto-deploys, apply every new migration to production right after its code merges.

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

Round 8: `theses_headline_nonblank` requires at least one non-whitespace headline character for every thesis. Existing blank headlines require reconciliation before migration 0003 can succeed. The AI context validator trims headlines and rejects blank values; the strict builder reports `INVALID_VALUE`. No maximum length is introduced.

Round 9: headline nonblank validation uses the locale-independent ECMAScript WhiteSpace + LineTerminator set stripped by `String.prototype.trim` (ECMA-262 TrimString). SQL uses `btrim` with explicit Unicode escapes, defined in `src/schema/theses.ts` and copied into migration 0003 and its snapshot. Empty, ASCII-only, NBSP-only, figure-space-only, narrow-NBSP-only and BOM-only headlines are rejected; NBSP between words is accepted. The offline differential test decodes the actual SQL set and compares 20 inputs with JavaScript trimming, and checks schema/migration/snapshot agreement. Integration tests exercise SQL insert/update acceptance and rejection.

Concurrency coverage now varies both publisher A and mutator B across READ COMMITTED, REPEATABLE READ and SERIALIZABLE. Added publication-first cases commit A with constraints still deferred; mutation-first cases likewise leave A deferred through COMMIT and require `phase: "commit"` on rejection (23514 at READ COMMITTED, 40001 for a stale stronger-isolation publisher). Existing explicit-validation schedules, lock-wait observation and timeouts remain. This round's writer runs offline only; these added schedules require orchestrator live execution.

## Slugs and handles

`theses.slug` is required, unique, and matches `^[a-z0-9]+(-[a-z0-9]+)*$`.
`src/slug.ts` exports pure `deriveSlug(headline, uuid, occupied)` for future writers.
ASCII uppercase becomes lowercase; runs outside ASCII letters/digits become one
hyphen. Trim edge hyphens, keep the first six words and 64 characters, then trim
a trailing hyphen. TODO-OWNER: six words / 64 characters are placeholder prefix
limits. Append four UUID hex characters, extending one character at a time on
collision. Empty-after-strip headlines use the full UUID hex alone. The backfill
processes UUIDs in ascending order; a full 32-hex suffix distinguishes distinct
UUIDs, and empty-prefix slugs have no hyphens so cannot collide with prefixed ones.
Allocation is deterministic given the occupied set; concurrent writers must catch
the unique violation and retry. No default or insert trigger silently chooses a slug.
New thesis writers must supply it. Existing slugs are not recomputed on headline edits.

Migration 0005 disables only the thesis relationship trigger during its backfill,
then restores it before enforcing NOT NULL. This preserves permitted linked drafts
without changing their backing. Apply through Drizzle's migration transaction;
never run the statements piecemeal. Its generated snapshot models the final schema.

`users.handle` is nullable, unique when set, and accepts lowercase ASCII letters,
digits and underscores. TODO-OWNER: the enforced 1–32 character bounds are
placeholders for the owner. The handle is written by the profile editor on the user's own page (`apps/web/src/lib/profile/writes.ts`: session-scoped UPDATE, lowercased and pattern-checked before the query, unique violation → `handle_taken`);
wallet identity creation continues to insert the address only, leaving handle NULL.
Golden normalization tests run offline; the integration suite executes the actual
0005 backfill block and compares its results with TypeScript across Unicode,
punctuation and suffix collisions. The orchestrator must run that SQL differential.

Snapshot inventory: `0000`, `0001`, `0003`, `0005`, `0006`, `0007`, `0008` and `0009` have snapshots in `src/migrations/meta/` (measured 2026-09-06 06:56). The hand-written `0002` and `0004` migrations have no snapshots.
