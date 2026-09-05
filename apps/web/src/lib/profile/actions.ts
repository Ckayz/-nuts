"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "../auth/session";
import { usingDatabase } from "../data/source";
import { creatorInitials } from "../data/identity";
import { walletGuard } from "../social/guards";
import type { ProfileInput } from "./validation";

/**
 * B-P3-2 (lane B pass 3, MAJOR). The same consistency check the social writes
 * gained in G-4, on the one write that was left without it.
 *
 * `walletAddress` is the wallet the browser is holding as it calls
 * (`components/auth/connected-identity.ts`). It is NEVER an authorisation: the
 * session cookie decides who the actor is, and a claim that disagrees with it
 * can only REFUSE. A caller that omits it behaves exactly as before.
 *
 * What it closes: a mismatch sign-out that FAILS leaves the cookie on the old
 * account while the wallet is a new one, and until the retry lands this action
 * saved the new person's handle, display name and bio onto the old account —
 * measured, `ACTOR [{"id":"c0000000-…-000000000001","input":{"displayName":
 * "Changed while B"}}]`.
 *
 * What it does NOT close, said plainly: the server cannot learn which wallet a
 * browser has connected, so a caller that simply omits the field gets the old
 * behaviour. This stops MIS-ATTRIBUTION for the honest browser; it is not a
 * defence against a hostile one, and no code should read it as one.
 */
export async function updateProfile(input: ProfileInput, walletAddress?: string) {
	const session = await getSession();
	if (!session) return { error: "sign_in_required" } as const;
	const wrongWallet = walletGuard(session.walletAddress, walletAddress);
	if (wrongWallet) return wrongWallet;
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
