# Profile round 1 writer handoff

Base probe: `git rev-parse HEAD` → `81c26ecc2dcdca237705d1cce541bf251e5d2655`.
No writing git commands, network calls, database connections, servers, transactions, or builds were run. Edits remain uncommitted within the requested fence. No independent review performed.

Implemented: session-scoped profile writer, runtime validation, nullable clearing, nested PostgreSQL unique-error handling, owner-only raw edit fields and editor, profile rail identity server probe, and unwired market rail/tabs. The editor gives an optimistic pending preview, retains entered fields on failure, and replaces the URL using the successful response. The me link re-reads identity on click to avoid navigating with a stale session/handle.

## Evidence

`DATABASE_URL='' SKIP_ENV_VALIDATION=1 bun run check-types --force`:
```
 Tasks:    3 successful, 3 total
Cached:    0 cached, 3 total
```
Turbo also printed `WARNING IO error: Operation not permitted (os error 1)` for shared cache access.

From apps/web, `DATABASE_URL='' SKIP_ENV_VALIDATION=1 bunx tsc --noEmit`: exit 0, no output.

From apps/web, `DATABASE_URL='' SKIP_ENV_VALIDATION=1 bun test`:
```
 152 pass
 4 skip
 0 fail
 461 expect() calls
Ran 156 tests across 13 files. [1.53s]
```
Database URL for this run was the empty string; no live test results are claimed.

After restoring all mutations, focused `bun test src/lib/profile` with the same environment:
```
 6 pass
 1 skip
 0 fail
 24 expect() calls
Ran 7 tests across 2 files. [25.00ms]
```

| Mutation | Focused validation test exit |
| --- | --- |
| Remove handle pattern guard | 1 |
| Remove handle length guard | 1 |
| Keep empty string instead of null | 1 |
| Remove lowercase normalization | 1 |
| Recognize 23514 instead of 23505 | 1 |

Session identity/WHERE fence, actual duplicate handling, and owner rendering are NOT mutation-verified here. The integration test covers set, clear, invalid input, missing actor, caller-supplied userId isolation, and duplicate; it skips without DATABASE_URL and rolls its fixture transaction back. The orchestrator must run it on its own migrated database.

`git diff --check`: exit 0, no output.
Source scan for forbidden escape patterns across all fenced changed/new TypeScript files: no matches.

`git status --short` before adding this report:
```
 M apps/web/src/app/u/[handle]/page.tsx
 M apps/web/src/components/shell/icon-rail.tsx
 M apps/web/src/lib/page-data.ts
?? apps/web/src/components/creator/profile-editor.tsx
?? apps/web/src/components/market/tagged-posts-tabs.tsx
?? apps/web/src/components/market/your-positions-rail.tsx
?? apps/web/src/lib/profile/
```

## Merge wiring and dependencies

In `src/app/m/[asset]/page.tsx`, import:
```tsx
import { YourPositionsRail } from "@/components/market/your-positions-rail";
import { TaggedPostsTabs } from "@/components/market/tagged-posts-tabs";
```
Inside the market left aside, after its asset list:
```tsx
<YourPositionsRail asset={asset} />
```
Replace the tagged-post heading/feed block with:
```tsx
<TaggedPostsTabs posts={posts} signedIn={signedIn} databaseMode={databaseMode} />
```
Here `asset` is the resolved asset symbol, `posts` is the market-filtered `View.Thesis[]`, and the booleans are the server mode/session flags. Bind these to trade-r1's final variable names at merge; that page was not edited. Backed means `post.backing !== null`.

Dependencies/gaps:
- Base `getPortfolio` inner-joins theses. trade-r1 must merge its standalone-capable reader; otherwise standalone positions are absent.
- Position links require position-r1's `/p/[id]` route. Object-form href allows this worktree to typecheck before that route lands.
- Existing getPortfolio page cap applies before the asset filter; open count is the returned subset, not a database-wide count. Changing reads.ts is outside this fence.
- Domain positions expose no structure label. Rail uses the linked thesis headline, falling back to underlying asset for standalone rows; it cannot reproduce the mockup's strike/expiry label from the current contract. Orchestrator should route the missing structure-label data to its owner.
- Signed-out and mock-mode market rail render nothing. Mock me link restores the original fixture after the server mode probe; initial render is an empty profile button while mode is unknown.
- Header has no shared session-change event. Rail rechecks on navigation, focus, profile save and click; its avatar can remain stale after same-page header sign-in/out until one of those events. Click always rechecks.
- No browser validation, both next build route tables, live DB test counts, database create/drop or port probe: not run. No database or port was allocated, so none required cleanup. No next build attempted, as explicitly instructed.
- No git fetch attempted: this writer was explicitly given no network and forbidden writing git commands.
- No CLAUDE.md update: outside the explicit fence.

## TODO-OWNER locations

New:
- `apps/web/src/lib/profile/validation.ts:12`: 1–32 handle bound mirrors schema; display-name/bio limits unset.
- `apps/web/src/components/creator/profile-editor.tsx:13`: editor labels, Save/error copy and limits; no approved profile-edit mockup.

Pre-existing in modified files:
- `apps/web/src/lib/page-data.ts:90`: social ranking formulas.
- `apps/web/src/lib/page-data.ts:126`: settlement wording and spot series.

## Source reads

Read CLAUDE.md, PRD sections 3/8/11/12, users schema, social actions/writes/tests, session actions, data reads/identity, display/domain types, mockup market rail/tabs, and existing ThesisTabs keyboard implementation.
The wallet bar is `apps/web/src/components/auth/wallet-bar.tsx`; probing components/shell/wallet-bar.tsx returned `No such file or directory`.
Skills found and read at `/Users/aarontan/.claude/skills/verify-first/SKILL.md` and `/Users/aarontan/.claude/skills/fable-method/SKILL.md`.
Next docs read:
- `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`
- `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`
