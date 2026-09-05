import "server-only";
import { eq } from "drizzle-orm";
import { users } from "@nuts/db/schema/index";
import type { Database } from "../data/reads";
import { isUniqueViolation, validateProfile } from "./validation";

export async function writeProfile(database: Database, userId: string | null, input: unknown) {
	if (!userId) return { error: "sign_in_required" } as const;
	const parsed = validateProfile(input);
	if ("error" in parsed) return parsed;
	try {
		const [profile] = await database.update(users).set({ ...parsed.fields, updatedAt: new Date() })
			.where(eq(users.id, userId)).returning({ handle: users.handle, displayName: users.displayName, bio: users.bio, walletAddress: users.walletAddress });
		return profile ? { profile } : { error: "sign_in_required" } as const;
	} catch (error) {
		if (isUniqueViolation(error)) return { error: "handle_taken" } as const;
		throw error;
	}
}
