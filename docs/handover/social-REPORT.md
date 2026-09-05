# Socials round 1 writer handoff

Measured 2026-09-05 05:49 UTC. Uncommitted and unreviewed; no writing git commands, push, migration, deployment, or real fill performed.

## Implemented

- Authenticated server actions `toggleLike`, `toggleFollow`, `addComment`; runtime UUID, desired-state, self-follow and trimmed/nonblank-comment guards. Anonymous actions return `{ error: "sign_in_required" }`.
- Like/comment public fence: open, expired, settled. Writes and positive like/comment activity share a transaction. Unlike retains historical like activity; retries setting the same desired state add no event.
- Optional boolean desired-state argument on toggles preserves retry idempotency. One-argument calls toggle once; they cannot mathematically be idempotent across retries.
- Follow/unfollow rows and counts, with sorted user locks. Follow activity is blocked by the schema gap below.
- Activity reader, thread/profile assembly and offchain rendering without transaction links or invented displayed money. The existing mandatory domain amount field remains a legacy placeholder; `socialDetail` bypasses monetary rendering.
- Follower/following counts, provisional 1W P&L leaderboard, engagement-ranked public theses, open-expiry ascending and settled-time descending reads. P&L arithmetic stays decimal-string/BigInt; unavailable components make the total unavailable and sort after known totals. Negative P&L remains negative.
- DB-mode leaderboard/trending rails and ending/settled data assembly. Existing owner-rule notes remain visible.
- Optimistic like/follow/comment UI, rollback to server data on failure, comment draft retained for deliberate retry. Mock mode stays local and makes no social action calls. Self-follow is disabled. Signed-out controls are disabled with a title referencing the header wallet control.
- Offline guard/formula tests and rollback-transaction integration tests. `getThread` already reads comments, so no duplicate listComments reader was added.

## Gaps and mismatches

1. **Follow activity cannot be represented.** `packages/db/src/schema/activity.ts` has CHECK `activity_domain_reference_required`: thesis_id or position_id is mandatory. There is no followed-user field. The follow writer deliberately does not fabricate a reference or weaken the CHECK. Schema/migration work belongs to the DB writer; follow activity remains incomplete.
2. **Ending/Settled labels are static spans.** The reads and `discoverData.ending`/`.settled` are implemented; selecting those tabs remains incomplete. `app/page.tsx` is props-only and `components/feed/thesis-list.tsx` is outside the fence. No new rail control was introduced.
3. **Expired thread presentation remains unavailable.** Social writes/read rankings accept expired, as requested. Existing display/page status handling allows open/settled only; an expired ranking link can still lead to the existing thread 404. No unapproved status presentation was invented.
4. **No reusable sign-in trigger.** WalletBar exports the entire wallet element, not its sign-in handler. The brief-authorized disabled/title fallback is used. Existing auth actions do not refresh these server-provided viewer props; a page refresh/navigation after signing in may be needed. Auth is outside the fence.
5. **Comment maximum length is unspecified.** Only type/trim/nonblank guards are enforced; no numeric cap was invented. Copy and limit are marked for owner decision.
6. **Routes at this HEAD still use UUID/address identities.** No slug/handle migration is present; polish integration is separate. Route-pattern revalidation covers future slug/handle routing too.
7. **Ranking/activity reads have no new cap.** They read the eligible data without silently truncating before ranking. Owner pagination/scalability policy remains pending; the wide review should attack query cost and locking/concurrency.
8. **No successful production build/route table.** Default Turbopack remained at the build-start message and was interrupted (exit 130). Supported Webpack fallback failed fetching existing Google Fonts (`ENOTFOUND fonts.googleapis.com`, exit 1). No font/layout changes or mocked-font build were used to claim success.
9. **Live integration validation: not run (no database).** More precisely, the exact requested offline command unexpectedly restored DATABASE_URL from environment-file loading and attempted the integration cases; connections were refused. No integration case was successfully validated. The explicit-empty-URL rerun correctly skipped all three integration files.

## Verification output

HEAD:

```text
f2ddeb9301ede17e1a773645b56b506b27bdf25c
```

`bun run check-types --force` (final run, exit 0; Turbo also printed cache IO permission warnings):

```text
Tasks:    3 successful, 3 total
Cached:    0 cached, 3 total
Time:    4.622s
```

`cd apps/web && bunx tsc --noEmit`: exit 0, no output. An earlier accidental root-level `bunx tsc --noEmit` failed because it lacked the web JSX/alias configuration; that was not counted as package verification.

Exact requested `cd apps/web && env -u DATABASE_URL bun test`: exit 1; environment loading restored a local database URL:

```text
error: connect ECONNREFUSED 127.0.0.1:54322
141 pass
51 fail
418 expect() calls
Ran 192 tests across 10 files.
```

Final offline invocation: `cd apps/web && DATABASE_URL='' SKIP_ENV_VALIDATION=1 bun test` (exit 0):

```text
auth integration skipped: DATABASE_URL is not set
social integration skipped: DATABASE_URL is not set
reads integration skipped: DATABASE_URL is not set
142 pass
3 skip
0 fail
423 expect() calls
Ran 145 tests across 10 files. [537.00ms]
```

Skipped files: `src/lib/auth/auth.integration.test.ts`, `src/lib/data/reads.integration.test.ts`, `src/lib/social/social.integration.test.ts`.

Social-only run: 13 pass, 0 fail, 32 assertions. The action-level anonymous probe substitutes only cookies/cache in a child Bun process; it invokes all three real action exports. Its initial cwd was one directory too high and failed to load the preload; corrected and rerun successfully.

`SKIP_ENV_VALIDATION=1 bunx next build`:

```text
▲ Next.js 16.3.4 (Turbopack)
- Environments: .env
Creating an optimized production build ...
```

Interrupted with exit 130 after no further output. `SKIP_ENV_VALIDATION=1 bunx next build --webpack`, exit 1:

```text
Error: getaddrinfo ENOTFOUND fonts.googleapis.com
Failed to compile.
src/app/layout.tsx
Failed to fetch `Archivo` from Google Fonts.
Failed to fetch `Bricolage Grotesque` from Google Fonts.
Failed to fetch `JetBrains Mono` from Google Fonts.
> Build failed because of webpack errors
```

No route table was produced. Full latest logs: `/tmp/social-r1-types.log`, `/tmp/social-r1-tests.log`, `/tmp/social-r1-build.log`, `/tmp/social-r1-build-webpack.log`.

`git diff --check`: exit 0, no output.

## Added owner markers (paths relative to apps/web)

- `src/lib/social/guards.ts:12`: comment maximum length.
- `src/lib/social/ranking.ts:8`: 1W window and P&L formula.
- `src/lib/social/ranking.ts:34`: engagement sum.
- `src/lib/social/ranking.ts:38`: expiry/settlement ordering.
- `src/lib/data/reads.ts:433`: provisional leaderboard formula/window.
- `src/lib/page-data.ts:88`: provisional rail formulas.
- `src/components/thesis/comment-form.tsx:11`: comment copy and maximum length.

## Guard mutation targets

These are named tests that should fail if the corresponding guard is removed; no claim that a mutation campaign was run.

| Guard | Test |
| --- | --- |
| Session before writes | `anonymous writes return sign_in_required before database access` |
| Real action session branch | `server actions return sign_in_required with no cookie and never revalidate` |
| UUID | `malformed UUID writes are rejected before database access` |
| Self-follow/case normalization | `self follow is rejected case-insensitively before database access` |
| Desired-state type | `non-boolean desired states are rejected` |
| Trim/nonblank | `blank and Unicode whitespace comments are rejected before database access` |
| Public/missing thesis | Integration: `public fence rejects draft and missing like/comment targets, accepts expired` |
| Idempotency/activity duplication | Integration: `like and unlike desired-state retries are idempotent with one activity` |
| Activity privacy/ordering | Integration: `activity excludes draft references and orders events newest first` |
| Confirmation/status/window | `window includes boundary and excludes old future pending failed and unconfirmed` |
| Money availability | `NaN and null P&L make totals unavailable, after negative known totals` |
| Trending status/components | `trending sums likes comments and filled participants, excludes draft` |
| Expiry/status | `ending orders only open dated theses by expiry ascending` |
| Settlement/status | `settled orders only settled theses newest first, missing date last` |

The integration file also covers follow/unfollow, comment+activity, actor-filtered activity, seeded P&L/NaN/window behavior and participation/ending/settled ordering. Orchestrator must run it on an isolated migrated database and perform the one-shot review.

## Final path fence

`git status --short`:

```text
 M apps/web/src/app/page.tsx
 M apps/web/src/app/t/[slug]/page.tsx
 M apps/web/src/app/u/[handle]/page.tsx
 M apps/web/src/components/creator/activity-list.tsx
 M apps/web/src/components/creator/creator-stats.tsx
 M apps/web/src/components/feed/callout-post.tsx
 M apps/web/src/components/feed/like-button.tsx
 M apps/web/src/components/thesis/comments-list.tsx
 M apps/web/src/lib/data/map.ts
 M apps/web/src/lib/data/reads.ts
 M apps/web/src/lib/display-types.ts
 M apps/web/src/lib/display.ts
 M apps/web/src/lib/page-data.ts
 M apps/web/src/types.ts
?? apps/web/src/components/thesis/comment-form.tsx
?? apps/web/src/lib/social/
```

Forbidden TypeScript constructs: no `any` type, suppression directives, or double assertion introduced. A raw whole-file word scan matched only the pre-existing English copy “author can tag one at any time” in the thread page; it is not a TypeScript type. All changed paths are inside the supplied fences. CLAUDE.md and the review ledger were not edited because they are outside this writer fence.
