import { describe, expect, test } from "bun:test";
import { Client } from "pg";
import { seed } from "./fixtures/schema";

const databaseUrl = process.env.DATABASE_URL;
type Phase = "mutation" | "validation" | "commit";
type Outcome = { committed: true } | { committed: false; code?: string; phase: Phase };

async function finish(client: Client, sql: string, params: string[]): Promise<Outcome> {
  let phase: Phase = "mutation";
  try {
    phase = "mutation";
    await client.query(sql, params);
    phase = "validation";
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    phase = "commit";
    await client.query("COMMIT");
    return { committed: true };
  } catch (error) {
    await Promise.allSettled([client.query("ROLLBACK")]);
    return { committed: false, phase, code: (error as { code?: string }).code };
  }
}

// Observe an actual lock wait, not a sleep-based guess. The observer is the
// transaction holding the lock; only these two clients are needed.
async function waitForBlock(observer: Client, blockedPid: number, blockerPid: number, settled: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query("SELECT $2::int = ANY(pg_catalog.pg_blocking_pids($1::int)) AS blocked", [blockedPid, blockerPid]);
    if (result.rows[0]?.blocked) return;
    if (settled()) throw new Error("contending transaction finished without the required row lock wait");
    await Bun.sleep(10);
  }
  throw new Error("did not observe the required row lock wait");
}

if (!databaseUrl) {
  console.log("schema concurrency skipped: DATABASE_URL is not set");
  test.skip("creator invariant concurrency requires DATABASE_URL", () => {});
} else describe("creator invariant concurrency", () => {
  for (const isolation of ["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"] as const) {
    for (const variant of ["position", "wallet"] as const) {
      for (const first of ["publication", "mutation", ...(isolation !== "READ COMMITTED" ? ["publication-committed" as const] : [])] as const) {
        test(`${isolation} ${variant}: ${first} validates first`, async () => {
          const a = new Client({ connectionString: databaseUrl });
          const b = new Client({ connectionString: databaseUrl });
          const ids = { u1: crypto.randomUUID(), u2: crypto.randomUUID(), t1: crypto.randomUUID(), t2: crypto.randomUUID(), p1: crypto.randomUUID() };
          let pending: Promise<Outcome> | undefined;
          let failed = false;
          let connectedA = false;
          let connectedB = false;
          try {
            await a.connect(); connectedA = true;
            await b.connect(); connectedB = true;
            await a.query("SET statement_timeout = '10s'");
            await b.query("SET statement_timeout = '10s'");
            await a.query("BEGIN");
            await seed(a, ids, true);
            await a.query("COMMIT");
            const aPid = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
            const bPid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
            await a.query("BEGIN ISOLATION LEVEL READ COMMITTED");
            await b.query(`BEGIN ISOLATION LEVEL ${isolation}`);
            // BEGIN alone does not open a REPEATABLE READ/SERIALIZABLE snapshot. Pin it before
            // A publishes, including the schedule where B mutates after A commits.
            const snapshot = await b.query("SELECT status,creator_position_id FROM public.theses WHERE id=$1", [ids.t1]);
            expect(snapshot.rows).toEqual([{ status: "draft", creator_position_id: null }]);
            const publish = "UPDATE public.theses SET creator_position_id=$1,status='open' WHERE id=$2";
            const publishParams = [ids.p1, ids.t1];
            const mutate = variant === "position"
              ? "UPDATE public.positions SET status='failed' WHERE id=$1"
              : "UPDATE public.users SET wallet_address=wallet_address || 'a' WHERE id=$1";
            const mutateParams = [variant === "position" ? ids.p1 : ids.u1];
            let settled = false;
            let results: Outcome[];
            if (first === "publication-committed") {
              // No overlap in row locks: without touch writes B can update P/U
              // and miss the published link entirely in its pre-publication snapshot.
              const publication = await finish(a, publish, publishParams);
              expect(publication).toEqual({ committed: true });
              results = [publication, await finish(b, mutate, mutateParams)];
            } else if (first === "publication") {
              // Without touch writes, REPEATABLE READ B waits on FOR SHARE,
              // then still sees the unlinked draft and commits an invalid state.
              // READ COMMITTED B instead sees the committed link after waiting.
              await a.query(publish, publishParams);
              await a.query("SET CONSTRAINTS ALL IMMEDIATE");
              pending = finish(b, mutate, mutateParams).then((result) => { settled = true; return result; });
              await waitForBlock(a, bPid, aPid, () => settled);
              await a.query("COMMIT");
              results = [{ committed: true }, await pending];
            } else {
              // FOR SHARE remains necessary in the reverse order: A must wait
              // for B and reject its now-invalid position/wallet. Touch writes
              // fix the publication-first cases; this schedule guards retention
              // of the existing read locks (touches alone after stale checks
              // would not revalidate the values read before B committed).
              await b.query(mutate, mutateParams);
              await b.query("SET CONSTRAINTS ALL IMMEDIATE");
              pending = finish(a, publish, publishParams).then((result) => { settled = true; return result; });
              await waitForBlock(b, aPid, bPid, () => settled);
              await b.query("COMMIT");
              results = [await pending, { committed: true }];
            }
            expect(results.filter((result) => result.committed)).toHaveLength(1);
            expect(results.filter((result) => !result.committed)).toEqual([{ committed: false, code: isolation !== "READ COMMITTED" && first !== "mutation" ? "40001" : "23514", phase: isolation !== "READ COMMITTED" && first !== "mutation" ? "mutation" : "validation" }]);
            const invalid = await a.query(`SELECT t.id FROM public.theses t
              LEFT JOIN public.positions p ON p.id=t.creator_position_id
              JOIN public.users u ON u.id=t.creator_user_id
              WHERE t.id=$1 AND t.creator_position_id IS NOT NULL AND t.status IN ('open','expired','settled') AND
                (p.id IS NULL OR p.status NOT IN ('confirmed','indexed','expired','settled')
                 OR p.confirmed_at IS NULL OR p.wallet_address IS DISTINCT FROM u.wallet_address
                 OR p.thesis_id<>t.id OR p.user_id<>u.id OR p.role<>'creator' OR p.chain_id<>8453)`, [ids.t1]);
            expect(invalid.rows).toEqual([]);
          } catch (error) {
            failed = true;
            throw error;
          } finally {
            try {
              // Rollbacks queued behind a blocked query are bounded by statement_timeout.
              // Await both before removing committed fixtures, including on assertion failure.
              await Promise.allSettled([
                connectedA ? a.query("ROLLBACK") : Promise.resolve(),
                connectedB ? b.query("ROLLBACK") : Promise.resolve(),
              ]);
              if (pending) await Promise.allSettled([pending]);
              if (connectedA) {
                await a.query("BEGIN");
                // Break the circular immediate FKs before deleting either row.
                await a.query("UPDATE public.theses SET creator_position_id=NULL,status='draft' WHERE id=$1", [ids.t1]);
                await a.query("DELETE FROM public.positions WHERE id=$1", [ids.p1]);
                await a.query("DELETE FROM public.theses WHERE id IN ($1,$2)", [ids.t1, ids.t2]);
                await a.query("DELETE FROM public.auth_challenges WHERE nonce=$1", [ids.u1]);
                await a.query("DELETE FROM public.users WHERE id IN ($1,$2)", [ids.u1, ids.u2]);
                await a.query("COMMIT");
              }
            } catch (cleanupError) {
              // Do not replace a failed assertion/query with a cleanup error.
              if (!failed) throw cleanupError;
            } finally {
              // Outermost cleanup always attempts BOTH ends, even if rollback or
              // fixture cleanup failed. allSettled preserves the original error.
              await Promise.allSettled([a.end(), b.end()]);
            }
          }
        }, 30_000);
      }
    }
  }
});
