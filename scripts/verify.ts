import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// ONE destination fence, shared with both bun-test preloads and
// packages/db/drizzle.config.ts. Imported by relative path because the root
// workspace does not depend on @nuts/db; the module has no imports of its own.
import { databaseUrlRefusal } from "../packages/db/src/test-fence";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--offline")) {
  console.error("Usage: bun run verify [--offline]");
  process.exit(2);
}
const offline = args.includes("--offline");

/**
 * A-m1. In online mode the run must be pinned to ONE explicitly selected,
 * migrated, loopback test database.
 *
 * Before this, `bun run verify` with no `DATABASE_URL` reported every database
 * step PASS: the live suites print a skip line and exit 0, and each CHILD then
 * resolved its own `DATABASE_URL` through `@nuts/env/load` (apps/web/.env),
 * which on the owner's machine holds the production Supabase URL. A green table
 * therefore proved neither that the live suites ran nor which database they ran
 * against. Three fences replace that:
 *
 *  1. `DATABASE_URL` must be present in the REAL parent environment — a value
 *     that only an env file supplies is not an explicit selection;
 *  2. the destination must survive the shared fence in
 *     `packages/db/src/test-fence.ts` — loopback host, no destination-override
 *     query parameter, no `PGOPTIONS` — overridable only by a deliberate
 *     `TEST_DATABASE_OK=1`. Both `bun test` preloads and `drizzle.config.ts` use
 *     that same function, so the four copies that had drifted apart cannot
 *     drift again;
 *  3. the applied migrations must be EXACTLY the journal's: missing, extra and
 *     duplicated hashes all fail, so a stale throwaway or one migrated from
 *     another tree fails loudly here instead of mid-suite.
 *
 * The value is then forced into every child, and any mandatory live suite that
 * still reports itself skipped fails its step.
 *
 * Every live suite prints this exact tail when it skips itself:
 */
const SKIP_SENTINEL = "skipped: DATABASE_URL is not set";

/**
 * Runs inside `packages/db` (where `pg` resolves) and proves the selected
 * database carries EXACTLY this tree's migrations — missing, extra AND
 * duplicated hashes all refuse. The comparison itself lives in
 * `packages/db/src/migration-check.ts` so it can be unit-tested; this probe only
 * reads the journal and the table.
 */
const MIGRATION_PROBE = `
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
const { migrationMismatches } = await import(resolve(process.cwd(), "src/migration-check.ts"));
const dir = resolve(process.cwd(), "src/migrations");
const journal = JSON.parse(readFileSync(resolve(dir, "meta/_journal.json"), "utf8"));
const expected = journal.entries.map((entry) => ({
  tag: entry.tag,
  hash: createHash("sha256").update(readFileSync(resolve(dir, entry.tag + ".sql"))).digest("hex"),
}));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
} catch (error) {
  console.error("cannot connect: " + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}
let applied;
try {
  const result = await client.query("select hash from drizzle.__drizzle_migrations order by id");
  applied = result.rows.map((row) => row.hash);
} catch {
  console.error("no drizzle.__drizzle_migrations table: the database has never been migrated");
  await client.end();
  process.exit(1);
}
await client.end();
const problems = migrationMismatches(expected, applied);
if (problems.length > 0) {
  console.error(problems.join("; "));
  process.exit(1);
}
console.log(expected.length + " migrations applied");
`;

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const databaseUrl = (process.env.DATABASE_URL ?? "").trim();

if (!offline) {
  if (databaseUrl === "") {
    fail(
      "bun run verify needs DATABASE_URL to name a migrated loopback throwaway database.\n" +
        "  createdb verify_run  (or: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -qc 'create database verify_run')\n" +
        "  cd packages/db && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/verify_run bunx drizzle-kit migrate\n" +
        "  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/verify_run bun run verify\n" +
        "Use `bun run verify --offline` to run the offline subset instead.",
    );
  }
  // Fence 2, identical to both test preloads because it is literally the same
  // function: loopback host, no destination-override query parameter, no
  // PGOPTIONS.
  const refusal = databaseUrlRefusal(databaseUrl, process.env.TEST_DATABASE_OK, process.env.PGOPTIONS, "verify");
  if (refusal !== null) fail(refusal);

  // Fence 3: the journal's migrations must all be applied. `pg` resolves inside
  // packages/db, not at the repository root, so the probe runs there.
  const probe = Bun.spawn(
    ["bun", "-e", MIGRATION_PROBE],
    { cwd: resolve(root, "packages/db"), env: { ...process.env, DATABASE_URL: databaseUrl }, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const [probeOut, probeErr, probeCode] = await Promise.all([
    new Response(probe.stdout).text(),
    new Response(probe.stderr).text(),
    probe.exited,
  ]);
  if (probeCode !== 0) {
    fail(
      `The test database is not usable: ${(probeOut + probeErr).trim()}\n` +
        "Apply the migrations first: cd packages/db && DATABASE_URL=<url> bunx drizzle-kit migrate",
    );
  }
  console.log(`Verifying against ${databaseUrl.replace(/:\/\/[^@]*@/, "://***@")} — ${probeOut.trim()}`);
}

// Offline: empty values prevent Bun/dotenv from restoring credentials from env
// files. Online: the parent's explicitly selected URL is forced into every
// child, so no child can silently pick a different database out of `.env`.
const environment = {
  ...process.env,
  ...(offline
    ? { DATABASE_URL: "", DIRECT_DATABASE_URL: "", SKIP_ENV_VALIDATION: "1" }
    : { DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL ?? "" }),
};
const steps = [
  { cwd: ".", cmd: ["bun", "run", "check-types", "--force"] },
  { cwd: "packages/db", cmd: ["bunx", "drizzle-kit", "check"] },
  { cwd: "packages/db", cmd: ["bun", "test"], live: true },
  { cwd: "packages/thetanuts", cmd: ["bun", "test"] },
  { cwd: "packages/env", cmd: ["bun", "test"] },
  { cwd: "apps/web", cmd: ["bunx", "tsc", "--noEmit"] },
  { cwd: "apps/web", cmd: ["bun", "test"], live: true },
  // Production builds are DB builds: `next build` sets NODE_ENV=production and the
  // data-source guard refuses fixtures there (no build-phase exemption). Mock mode
  // is `next dev` only, so the build is verified once, in db mode.
  { cwd: "apps/web", cmd: ["bunx", "next", "build"], build: true, db: true },
];
const results: { directory: string; command: string; result: string }[] = [];
let failed = false;
if (offline) console.log("Offline: database credentials cleared; live DB suites and the one db-mode build skipped.");
for (const step of steps) {
  let cmd = step.cmd;
  if (offline && cmd[0] === "bun" && cmd[1] === "test") {
    const files = [...new Bun.Glob("**/*.{test,spec}.{ts,tsx,js,jsx}").scanSync({ cwd: resolve(root, step.cwd), onlyFiles: true })]
      .filter((file) => !file.split("/").some((part) => ["node_modules", ".next", ".turbo"].includes(part))).sort();
    const live = /\.(integration|concurrency)\.(test|spec)\./;
    for (const file of files.filter((file) => live.test(file))) console.log(`SKIP (offline): ${step.cwd}/${file}`);
    const selected = files.filter((file) => !live.test(file));
    if (!selected.length) throw new Error(`No offline tests found in ${step.cwd}`);
    cmd = ["bun", "test", ...selected.map((file) => `./${file}`)];
  }
  const command = `${step.db ? "DATA_SOURCE=db " : ""}${step.cmd.join(" ")}`;
  const row = { directory: step.cwd, command, result: "NOT RUN" };
  results.push(row);
  if (failed) continue;
  if (offline && step.build) { row.result = "SKIP (offline)"; continue; }
  console.log(`\n[${step.cwd}] ${command}`);
  try {
    // Live steps are teed so a self-reported skip can fail the step; the output
    // still streams, so a long suite is not silent.
    const watchForSkips = step.live === true && !offline;
    const child = Bun.spawn(cmd, {
      cwd: resolve(root, step.cwd),
      env: { ...environment, ...(step.db ? { DATA_SOURCE: "db" } : {}) },
      stdin: "inherit",
      stdout: watchForSkips ? "pipe" : "inherit",
      stderr: watchForSkips ? "pipe" : "inherit",
    });
    let captured = "";
    if (watchForSkips) {
      const tee = async (stream: ReadableStream<Uint8Array>, sink: { write(text: string): unknown }) => {
        const decoder = new TextDecoder();
        for await (const chunk of stream) {
          const text = decoder.decode(chunk, { stream: true });
          captured += text;
          sink.write(text);
        }
      };
      // `stdout`/`stderr` are typed optional because they are only streams when
      // the spawn asked for "pipe" — which is exactly what `watchForSkips` set
      // three lines above. The guard can therefore never fire; it exists so the
      // step fails loudly instead of silently losing the skip-sentinel check if
      // that pairing is ever broken.
      const { stdout, stderr } = child;
      if (!stdout || !stderr) throw new Error("Expected piped stdout and stderr for a live step");
      await Promise.all([tee(stdout, process.stdout), tee(stderr, process.stderr)]);
    }
    const code = await child.exited;
    if (code === 0 && watchForSkips && captured.includes(SKIP_SENTINEL)) {
      const skipped = captured.split("\n").filter((line) => line.includes(SKIP_SENTINEL));
      console.error(`\nA mandatory live suite skipped itself despite DATABASE_URL being set:\n${skipped.join("\n")}`);
      row.result = "FAIL (live suite skipped)";
      failed = true;
    } else {
      row.result = code === 0 ? "PASS" : `FAIL (${code})`;
      failed = code !== 0;
    }
  } catch (error) {
    row.result = "FAIL (spawn)";
    console.error(error);
    failed = true;
  }
}
console.table(results);
process.exitCode = failed ? 1 : 0;
