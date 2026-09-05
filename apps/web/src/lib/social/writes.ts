import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { comments, follows, likes, theses, users } from "@nuts/db/schema/index";
import type { Database } from "../data/reads";
import { mapComment } from "../data/map";
import { actorGuard, commentBody, desiredStateGuard, SOCIAL_PUBLIC_STATUSES, type SocialError } from "./guards";
import { recordActivity } from "./activity";
import type { Comment } from "@/types";

/** desired makes retries idempotent. Omitting it deliberately toggles once.
 * Lock the thesis to serialize its social count and public-status check.
 */
export async function writeLike(database: Database, actor: string | null, thesisId: string, desired?: boolean): Promise<{ liked: boolean; likes: number } | SocialError> {
	const error = actorGuard(actor, thesisId) ?? desiredStateGuard(desired);
	if (error) return error;
	const userId = actor!;
	return database.transaction(async tx => {
		const [post] = await tx.select({ id: theses.id }).from(theses).where(and(eq(theses.id, thesisId), inArray(theses.status, [...SOCIAL_PUBLIC_STATUSES]))).for("update");
		if (!post) return { error: "not_found" };
		const predicate = and(eq(likes.userId, userId), eq(likes.thesisId, thesisId));
		const [existing] = await tx.select().from(likes).where(predicate);
		const liked = desired ?? !existing;
		if (liked && !existing) {
			await tx.insert(likes).values({ userId, thesisId }).onConflictDoNothing();
			await recordActivity(tx, { userId, thesisId, eventType: "like" });
		} else if (!liked && existing) await tx.delete(likes).where(predicate);
		const [total] = await tx.select({ value: sql<string>`count(*)` }).from(likes).where(eq(likes.thesisId, thesisId));
		return { liked, likes: Number(total?.value ?? 0) };
	});
}
export async function writeFollow(database: Database, actor: string | null, target: string, desired?: boolean): Promise<{ following: boolean; followers: number } | SocialError> {
	const error = actorGuard(actor, target, true) ?? desiredStateGuard(desired);
	if (error) return error;
	const userId = actor!;
	return database.transaction(async tx => {
		// Sorted user locks also serialize opposite-direction concurrent follows.
		const locked = await tx.select({ id: users.id }).from(users).where(inArray(users.id, [userId, target])).orderBy(users.id).for("update");
		if (locked.length !== 2) return { error: "not_found" };
		const predicate = and(eq(follows.followerUserId, userId), eq(follows.followedUserId, target));
		const [existing] = await tx.select().from(follows).where(predicate);
		const following = desired ?? !existing;
		if (following) await tx.insert(follows).values({ followerUserId: userId, followedUserId: target }).onConflictDoNothing();
		else await tx.delete(follows).where(predicate);
		// Schema gap: a follow has neither thesisId nor positionId. Do not fake
		// a reference just to satisfy activity_domain_reference_required.
		const [total] = await tx.select({ value: sql<string>`count(*)` }).from(follows).where(eq(follows.followedUserId, target));
		return { following, followers: Number(total?.value ?? 0) };
	});
}
export async function writeComment(database: Database, actor: string | null, thesisId: string, body: string): Promise<Comment | SocialError> {
	const error = actorGuard(actor, thesisId);
	if (error) return error;
	const normalized = commentBody(body);
	if (typeof normalized !== "string") return normalized;
	const userId = actor!;
	return database.transaction(async tx => {
		const [post] = await tx.select({ id: theses.id }).from(theses).where(and(eq(theses.id, thesisId), inArray(theses.status, [...SOCIAL_PUBLIC_STATUSES]))).for("update");
		if (!post) return { error: "not_found" };
		const [user] = await tx.select().from(users).where(eq(users.id, userId));
		if (!user) return { error: "sign_in_required" };
		const [comment] = await tx.insert(comments).values({ userId, thesisId, body: normalized }).returning();
		if (!comment) throw new Error("Comment insert returned no row");
		await recordActivity(tx, { userId, thesisId, eventType: "comment" });
		return mapComment({ comment, user });
	});
}
