"use server";
import { revalidatePath } from "next/cache";
import { db } from "@nuts/db";
import { getSession } from "../auth/session";
import { usingDatabase } from "../data/source";
import { writeComment, writeFollow, writeLike } from "./writes";

function refreshSocialRoutes() {
	revalidatePath("/");
	revalidatePath("/t/[slug]", "page");
	revalidatePath("/u/[handle]", "page");
}
export async function toggleLike(thesisId: string, desired?: boolean) {
	const session = await getSession();
	if (!session) return { error: "sign_in_required" } as const;
	if (!usingDatabase()) return { error: "mock_mode" } as const;
	const result = await writeLike(db, session.userId, thesisId, desired);
	if (!("error" in result)) refreshSocialRoutes();
	return result;
}
export async function toggleFollow(userId: string, desired?: boolean) {
	const session = await getSession();
	if (!session) return { error: "sign_in_required" } as const;
	if (!usingDatabase()) return { error: "mock_mode" } as const;
	const result = await writeFollow(db, session.userId, userId, desired);
	if (!("error" in result)) refreshSocialRoutes();
	return result;
}
export async function addComment(thesisId: string, body: string) {
	const session = await getSession();
	if (!session) return { error: "sign_in_required" } as const;
	if (!usingDatabase()) return { error: "mock_mode" } as const;
	const result = await writeComment(db, session.userId, thesisId, body);
	if (!("error" in result)) refreshSocialRoutes();
	return result;
}
