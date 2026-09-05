import { defineConfig } from "drizzle-kit";
import { Client } from "pg";

// Shared loader: .env.local overrides .env, resolved from the repo rather than
// the current working directory. See packages/env/src/load.ts.
import "@nuts/env/load";

// Schema changes must not run through Supabase's transaction pooler, so
// migrations use the direct connection when one is configured. Locally the two
// are the same. Set BOTH URLs explicitly when selecting a migration target.
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || "";

if (url) {
  // URLSearchParams decodes percent-encoded names before the case-insensitive check.
  const overrides = new Set(["host", "hostaddr", "port", "dbname", "database"]);
  for (const name of new URL(url).searchParams.keys()) {
    if (overrides.has(name.toLowerCase())) {
      throw new Error("Drizzle-kit destination query overrides (host, hostaddr, port, dbname, database) are forbidden");
    }
  }
  // Constructing a Client parses exactly as Pool does; it does not connect.
  // @types/pg omits this runtime property of the installed driver.
  const { host, port, database } = (new Client({ connectionString: url }) as unknown as {
    connectionParameters: { host: string; port: number; database: string };
  }).connectionParameters;
  // Never print credentials or query parameters.
  console.error(`drizzle-kit target: ${host}:${port}/${database}`);
  if (!["127.0.0.1", "localhost"].includes(host) && process.env.DRIZZLE_ALLOW_REMOTE !== "1") {
    throw new Error("Remote drizzle-kit targets require DRIZZLE_ALLOW_REMOTE=1");
  }
}

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
});
