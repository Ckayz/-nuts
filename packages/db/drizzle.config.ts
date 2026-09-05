import { defineConfig } from "drizzle-kit";

// Shared loader: .env.local overrides .env, resolved from the repo rather than
// the current working directory. See packages/env/src/load.ts.
import "@nuts/env/load";

// Schema changes must not run through Supabase's transaction pooler, so
// migrations use the direct connection when one is configured. Locally the two
// are the same. Set BOTH URLs explicitly when selecting a migration target.
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || "";

if (url) {
  // Never print credentials or query parameters.
  const target = new URL(url);
  console.error(`drizzle-kit target: ${target.hostname}:${target.port || "5432"}${target.pathname}`);
  if (!["127.0.0.1", "localhost"].includes(target.hostname) && process.env.DRIZZLE_ALLOW_REMOTE !== "1") {
    throw new Error("Remote drizzle-kit targets require DRIZZLE_ALLOW_REMOTE=1");
  }
}

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
});
