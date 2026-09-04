import { env } from "@nuts/env/server";
import * as schema from "./schema";

import { drizzle } from "drizzle-orm/node-postgres";

export function createDb() {
	return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();

