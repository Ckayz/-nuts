import { describe, expect, test } from "bun:test";
import { Client } from "pg";
import { seed } from "./fixtures/schema";

const databaseUrl = process.env.DATABASE_URL;
type Outcome = { committed: true } | { committed: false; code?: string };

async function finish(client: Client, sql: string, params: string[]): Promise<Outcome> {
  try {
    await client.query(sql, params);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("COMMIT");
    return { committed: true };
  } catch (error) {
    await client.query("ROLLBACK");
    return { committed: false, code: (error as { code?: string }).code };
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
  for (const variant of ["position", "wallet"] as const) {
    for (const first of ["publication", "mutation"] as const) {
      test(`${variant}: ${first} validates first`, async () => {
        const a = new Client({ connectionString: databaseUrl });
        const b = new Client({ connectionString: databaseUrl });
        const ids = { u1: crypto.randomUUID(), u2: crypto.randomUUID(), t1: crypto.randomUUID(), t2: crypto.randomUUID(), p1: crypto.randomUUID() };
        let pending: Promise<Outcome> | undefined;
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
          await b.query("BEGIN ISOLATION LEVEL READ COMMITTED");
          const publish = "UPDATE public.theses SET creator_position_id=$1,status='open' WHERE id=$2";
          const publishParams = [ids.p1, ids.t1];
          const mutate = variant === "position"
            ? "UPDATE public.positions SET status='failed' WHERE id=$1"
            : "UPDATE public.users SET wallet_address=wallet_address || 'a' WHERE id=$1";
          const mutateParams = [variant === "position" ? ids.p1 : ids.u1];
          let settled = false;
          let results: Outcome[];
          if (first === "publication") {
            // Without FOR SHARE, B can validate against the old unlinked draft
            // and commit its failed status / changed wallet before A commits.
            await a.query(publish, publishParams);
            await a.query("SET CONSTRAINTS ALL IMMEDIATE");
            pending = finish(b, mutate, mutateParams).then((result) => { settled = true; return result; });
            await waitForBlock(a, bPid, aPid, () => settled);
            await a.query("COMMIT");
            results = [{ committed: true }, await pending];
          } else {
            // Without FOR SHARE, A reads the old confirmed position / wallet
            // while B's mutation is uncommitted, so both could commit invalid state.
            await b.query(mutate, mutateParams);
            await b.query("SET CONSTRAINTS ALL IMMEDIATE");
            pending = finish(a, publish, publishParams).then((result) => { settled = true; return result; });
            await waitForBlock(b, aPid, bPid, () => settled);
            await b.query("COMMIT");
            results = [await pending, { committed: true }];
          }
          expect(results.filter((result) => result.committed)).toHaveLength(1);
          expect(results.filter((result) => !result.committed)).toEqual([{ committed: false, code: "23514" }]);
          const invalid = await a.query(`SELECT t.id FROM public.theses t
            LEFT JOIN public.positions p ON p.id=t.creator_position_id
            JOIN public.users u ON u.id=t.creator_user_id
            WHERE t.id=$1 AND t.status IN ('open','expired','settled') AND
              (p.id IS NULL OR p.status NOT IN ('confirmed','indexed','expired','settled')
               OR p.confirmed_at IS NULL OR p.wallet_address IS DISTINCT FROM u.wallet_address
               OR p.thesis_id<>t.id OR p.user_id<>u.id OR p.role<>'creator' OR p.chain_id<>8453)`, [ids.t1]);
          expect(invalid.rows).toEqual([]);
        } finally {
          // Rollbacks queued behind a blocked query are bounded by statement_timeout.
          // Await both before removing committed fixtures, including on assertion failure.
          await Promise.all([
            connectedA ? a.query("ROLLBACK") : Promise.resolve(),
            connectedB ? b.query("ROLLBACK") : Promise.resolve(),
          ]);
          await pending;
          try {
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
          } finally {
            await Promise.all([connectedA ? a.end() : Promise.resolve(), connectedB ? b.end() : Promise.resolve()]);
          }
        }
      }, 30_000);
    }
  }
});
