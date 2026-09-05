import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--offline")) {
  console.error("Usage: bun run verify [--offline]");
  process.exit(2);
}
const offline = args.includes("--offline");
// Empty values prevent Bun/dotenv from restoring credentials from env files.
const environment = { ...process.env, ...(offline ? {
  DATABASE_URL: "", DIRECT_DATABASE_URL: "", SKIP_ENV_VALIDATION: "1",
} : {}) };
const steps = [
  { cwd: ".", cmd: ["bun", "run", "check-types", "--force"] },
  { cwd: "packages/db", cmd: ["bunx", "drizzle-kit", "check"] },
  { cwd: "packages/db", cmd: ["bun", "test"] },
  { cwd: "packages/thetanuts", cmd: ["bun", "test"] },
  { cwd: "packages/env", cmd: ["bun", "test"] },
  { cwd: "apps/web", cmd: ["bunx", "tsc", "--noEmit"] },
  { cwd: "apps/web", cmd: ["bun", "test"] },
  // Production builds are DB builds: `next build` sets NODE_ENV=production and the
  // data-source guard refuses fixtures there (no build-phase exemption). Mock mode
  // is `next dev` only, so the build is verified once, in db mode.
  { cwd: "apps/web", cmd: ["bunx", "next", "build"], build: true, db: true },
];
const results: { directory: string; command: string; result: string }[] = [];
let failed = false;
if (offline) console.log("Offline: database credentials cleared; live DB suites and both builds skipped.");
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
    const child = Bun.spawn(cmd, {
      cwd: resolve(root, step.cwd),
      env: { ...environment, ...(step.db ? { DATA_SOURCE: "db" } : {}) },
      stdin: "inherit", stdout: "inherit", stderr: "inherit",
    });
    const code = await child.exited;
    row.result = code === 0 ? "PASS" : `FAIL (${code})`;
    failed = code !== 0;
  } catch (error) {
    row.result = "FAIL (spawn)";
    console.error(error);
    failed = true;
  }
}
console.table(results);
process.exitCode = failed ? 1 : 0;
