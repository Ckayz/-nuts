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
  const overrides = new Set(["host", "hostaddr", "port", "dbname", "database", "options"]);
  for (const name of new URL(url).searchParams.keys()) {
    if (overrides.has(name.toLowerCase())) {
      throw new Error("Drizzle-kit destination query overrides (host, hostaddr, port, dbname, database, options) are forbidden");
    }
  }
  // Constructing a Client parses exactly as Pool does; it does not connect.
  // @types/pg omits this runtime property of the installed driver.
  const client = new Client({ connectionString: url });
  if (!("connectionParameters" in client)) {
    throw new Error("Cannot inspect drizzle-kit destination");
  }
  const parameters = client.connectionParameters;
  if (typeof parameters !== "object" || parameters === null ||
      !("host" in parameters) || typeof parameters.host !== "string" ||
      !("port" in parameters) || typeof parameters.port !== "number" ||
      !("database" in parameters) || typeof parameters.database !== "string") {
    throw new Error("Invalid drizzle-kit destination parameters");
  }
  // `pg` also reads PGOPTIONS (and other PG* variables) from the environment;
  // `-c search_path=…` there would relocate every migration's unqualified DDL
  // while the printed target still looks right (Astra review 2026-09-05). The
  // effective driver options must be empty.
  if ("options" in parameters && parameters.options !== undefined && parameters.options !== null && String(parameters.options) !== "") {
    throw new Error("Drizzle-kit destination carries driver options (PGOPTIONS or ?options=); refusing");
  }
  const { host, port, database } = parameters;
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
