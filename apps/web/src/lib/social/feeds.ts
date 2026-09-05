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

export async function following(options: ReadOptions = {}): Promise<Thesis[]> {
	if (!options.viewerUserId || !UUID.test(options.viewerUserId)) return [];
	const database = options.database ?? db;
	const creators = await database.select({ id: follows.followedUserId }).from(follows)
		.where(eq(follows.followerUserId, options.viewerUserId));
	if (creators.length === 0) return [];
	// Read before filtering without a feed-page cap: followed posts must not be
	// lost just because unrelated creators published more recently.
	return followingRows(await trending(options), creators.map(creator => creator.id));
}

/** TODO-OWNER: Top uses trending's provisional likes + comments + filled participants rule. */
export async function top(options: ReadOptions = {}, readRanked: typeof trending = trending): Promise<Thesis[]> {
	// Keep listFeed's open-post scope and the shared reader's ranking order.
	return (await readRanked(options)).filter(row => row.thesis.status === "open");
}
