/**
 * C#7 (lane C confirming pass, finding 7). A conversation about a TEXT post
 * must not make the execution tool unable to trade anything.
 *
 * Runs against a real database: the point is what `writePost` actually stores
 * for a plain text post, which is the fact the bug rested on.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@nuts/db";
import { activity, theses } from "@nuts/db/schema/index";
import { createOrFetchUser } from "@/lib/auth/store";
import { writePost } from "@/lib/thesis/publish";
import { findThesis } from "@/lib/trade/store";
import { attachmentFor, resolveThesisAttachment } from "./attachment";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.log("agent attachment integration skipped: DATABASE_URL is not set");
	test.skip("agent attachment integration requires DATABASE_URL", () => {});
}
const describeLive = databaseUrl ? describe : describe.skip;

let userId = "";
let wallet = "";

beforeAll(async () => {
	if (!databaseUrl) return;
	wallet = `0x${randomBytes(20).toString("hex")}`;
	const user = await createOrFetchUser(db, wallet);
	userId = user.id;
});

describeLive("C#7: a text post is context, not an attachment", () => {
	test("writePost really does leave the structure group null", async () => {
		const published = await writePost(db, {
			userId,
			headline: `Text post ${randomUUID().slice(0, 8)}`,
			rationale: "A pure text opinion, which the owner ruled is fine on its own.",
		});
		expect("error" in published).toBe(false);
		if ("error" in published) throw new Error(`writePost refused: ${published.error}`);

		const row = await findThesis(db, published.id);
		expect(row).not.toBeNull();
		expect(row?.underlyingAsset).toBeNull();

		// BEFORE: this id went straight into prepareTradeFor and resolveAttachment
		// answered THESIS_HAS_NO_STRUCTURE, so nothing could ever be executed.
		const resolved = await resolveThesisAttachment(published.id);
		expect(resolved.attach).toBeNull();
		expect(resolved.note).toContain("does not back the post");

		await db.delete(activity).where(eq(activity.thesisId, published.id));
		await db.delete(theses).where(eq(theses.id, published.id));
	});

	test("a post that names an instrument is still attached to, and still fenced by the shared path", async () => {
		const id = randomUUID();
		// `theses_structure_all_or_nothing`: the structure group is null-or-complete.
		await db.insert(theses).values({
			id,
			creatorUserId: userId,
			slug: `structured-${id.slice(0, 8)}`,
			headline: `Structured post ${id.slice(0, 8)}`,
			rationale: null,
			status: "open",
			direction: "bull",
			taggedAsset: "ETH",
			underlyingAsset: "ETH",
			expiryAt: new Date("2026-12-25T08:00:00Z"),
			productType: "PHYSICAL_PUT",
			isCall: false,
			isLong: false,
			strikes: ["250000000000"],
			strikeDecimals: 8,
			collateralAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
			collateralSymbol: "USDC",
			collateralDecimals: 6,
			creatorOrderSnapshot: {
				version: 1 as const,
				order: {
					maker: `0x${"1".repeat(40)}`,
					taker: `0x${"0".repeat(40)}`,
					option: `0x${"2".repeat(40)}`,
					isBuyer: false,
					numContracts: "10000",
					price: "50000000",
					expiry: "1893456000",
					nonce: "1",
				},
				signature: "0x00",
				availableAmount: "1000000",
				makerAddress: `0x${"1".repeat(40)}`,
			},
		});
		const resolved = await resolveThesisAttachment(id);
		expect(resolved).toEqual({ attach: id, note: null });
		await db.delete(theses).where(eq(theses.id, id));
	});

	test("a post that no longer exists is forwarded, so the shared path refuses it by name", async () => {
		const missing = randomUUID();
		expect(await resolveThesisAttachment(missing)).toEqual({ attach: missing, note: null });
		// And the pure half agrees.
		expect(attachmentFor(missing, null)).toEqual({ attach: missing, note: null });
	});
});
