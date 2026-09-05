import { defineConfig } from "drizzle-kit";

// Shared loader: .env.local overrides .env, resolved from the repo rather than
// the current working directory. See packages/env/src/load.ts.
import "@nuts/env/load";

// Schema changes must not run through Supabase's transaction pooler, so
// migrations use the direct connection when one is configured. Locally the two
// are the same and DIRECT_DATABASE_URL is simply absent.
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || "";

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
});
