"use server";
import { revalidatePath } from "next/cache";
import { db } from "@nuts/db";
import { getSession } from "../auth/session";
import { usingDatabase } from "../data/source";
import { walletGuard } from "./guards";
import { writeComment, writeFollow, writeLike } from "./writes";

/**
 * B-R2 (lane B pass 2), second half. Every write takes an OPTIONAL
 * `walletAddress`: the wallet the browser is holding as it calls
 * (`components/auth/connected-identity.ts`), the same thing `api/agent/chat`
 * already accepts from its client.
 *
 * It is a CONSISTENCY CHECK, never an authorisation: the session cookie decides
 * who the actor is, and a claim that disagrees with it only ever REFUSES. A
 * caller that says nothing behaves exactly as before, so nothing that does not
 * pass it changes.
 *
 * What it closes: a mismatch sign-out that FAILS leaves the cookie on the old
 * account while the wallet is a new one, and until the retry lands every like,
 * follow and comment is attributed to the account the person left.
 *
 * What it does NOT close, said plainly: a caller that simply omits the field
 * gets exactly the old behaviour. It cannot be otherwise — the server has no
 * way to learn which wallet a browser has connected — and it is not a hole,
 * because the only identity anything here can act as is the one already in the
 * signed cookie. This stops MIS-ATTRIBUTION for the honest browser; it is not a
 * defence against a hostile one, and no code should read it as one.
 */
function refreshSocialRoutes() {
	revalidatePath("/");
	revalidatePath("/t/[slug]", "page");
	revalidatePath("/u/[handle]", "page");
}
export async function toggleLike(thesisId: string, desired?: boolean, walletAddress?: string) {
	const session = await getSession();
	if (!session) return { error: "sign_in_required" } as const;
	const wrongWallet = walletGuard(session.walletAddress, walletAddress);
	if (wrongWallet) return wrongWallet;
	if (!usingDatabase()) return { error: "mock_mode" } as const;
	const result = await writeLike(db, session.userId, thesisId, desired);
	if (!("error" in result)) refreshSocialRoutes();
	return result;
}
export async function toggleFollow(userId: string, desired?: boolean, walletAddress?: string) {
	const session = await getSession();
	if (!session) return { error: "sign_in_required" } as const;
	const wrongWallet = walletGuard(session.walletAddress, walletAddress);
	if (wrongWallet) return wrongWallet;
	if (!usingDatabase()) return { error: "mock_mode" } as const;
	const result = await writeFollow(db, session.userId, userId, desired);
	if (!("error" in result)) refreshSocialRoutes();
	return result;
}
export async function addComment(thesisId: string, body: string, walletAddress?: string) {
	const session = await getSession();
	if (!session) return { error: "sign_in_required" } as const;
	const wrongWallet = walletGuard(session.walletAddress, walletAddress);
	if (wrongWallet) return wrongWallet;
	if (!usingDatabase()) return { error: "mock_mode" } as const;
	const result = await writeComment(db, session.userId, thesisId, body);
	if (!("error" in result)) refreshSocialRoutes();
	return result;
}
