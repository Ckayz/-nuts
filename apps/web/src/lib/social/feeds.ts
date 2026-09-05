import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@nuts/db";
import { follows } from "@nuts/db/schema/index";
import type { Thesis } from "@/types";
import { UUID } from "./guards";
import { trending, type ReadOptions } from "../data/reads";

/** Keep Following in the same newest-first, open-post scope as listFeed. */
export function followingRows(rows: readonly Thesis[], creatorIds: readonly string[]): Thesis[] {
	const followed = new Set(creatorIds);
	return rows.filter(row => row.thesis.status === "open" && followed.has(row.creatorUserId))
		.sort((a, b) => Date.parse(b.thesis.createdAt) - Date.parse(a.thesis.createdAt) || a.id.localeCompare(b.id));
}

export async function following(options: ReadOptions = {}, readRanked: typeof trending = trending): Promise<Thesis[]> {
	if (!options.viewerUserId || !UUID.test(options.viewerUserId)) return [];
	const database = options.database ?? db;
	const creators = await database.select({ id: follows.followedUserId }).from(follows)
		.where(eq(follows.followerUserId, options.viewerUserId));
	if (creators.length === 0) return [];
	const creatorIds = creators.map(creator => creator.id);
	// Select eligible posts by engagement before the cap, then retain Following's
	// existing newest-first presentation of those selected posts.
	return followingRows(await readRanked({ ...options, creatorIds, statuses: ["open"] }), creatorIds);
}

/** TODO-OWNER: Top uses trending's provisional likes + comments + filled participants rule. */
export async function top(options: ReadOptions = {}, readRanked: typeof trending = trending): Promise<Thesis[]> {
	// Keep listFeed's open-post scope and the shared reader's ranking order.
	return (await readRanked({ ...options, statuses: ["open"] })).filter(row => row.thesis.status === "open");
}
