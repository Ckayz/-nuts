"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "../auth/session";
import { usingDatabase } from "../data/source";
import { creatorInitials } from "../data/identity";
import type { ProfileInput } from "./validation";

export async function updateProfile(input: ProfileInput) {
	const session = await getSession();
	if (!session) return { error: "sign_in_required" } as const;
	if (!usingDatabase()) return { error: "mock_mode" } as const;
	const { db } = await import("@nuts/db");
	const { writeProfile } = await import("./writes");
	const result = await writeProfile(db, session.userId, input);
	if (!("error" in result)) {
		revalidatePath("/u/[handle]", "page");
		revalidatePath("/");
	}
	return result;
}

/** Server-owned mode and identity; never expose the database to the client rail. */
export async function readProfileLink() {
	if (!usingDatabase()) return { databaseMode: false, profile: null } as const;
	const session = await getSession();
	if (!session) return { databaseMode: true, profile: null } as const;
	const { db } = await import("@nuts/db");
	const { users } = await import("@nuts/db/schema/index");
	const { eq } = await import("drizzle-orm");
	const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
	return { databaseMode: true, profile: user ? { handle: user.handle ?? user.walletAddress, initials: creatorInitials(user.displayName, user.walletAddress) } : null } as const;
}
