/// <reference types="bun" />
import { beforeEach, expect, mock, test } from "bun:test";
import type { User } from "@nuts/db/schema/index";
import { textOnlyThesis } from "@nuts/db/fixtures/thesis-post.example";

import { getThesisContext, type ThesisContextReader, type ThesisContextRow } from "./thesis-context";

// The database boundary is injected, never module-mocked: a `mock.module`
// call is global to the whole `bun test` process and broke every
// real-database test file that ran after this one.
const findThesisWithRelations = mock(async (_thesisId: string): Promise<ThesisContextRow | undefined> => undefined);
const reader: ThesisContextReader = { findThesisWithRelations };
const thesisId = "10000000-0000-4000-8000-000000000001";

const creator: User = {
	id: textOnlyThesis.creatorUserId,
	walletAddress: "0x00000000000000000000000000000000000000a1",
	handle: null,
	displayName: null,
	bio: null,
	avatarUrl: null,
	createdAt: new Date("2026-09-01T00:00:00Z"),
	updatedAt: new Date("2026-09-01T00:00:00Z"),
};

beforeEach(() => {
	findThesisWithRelations.mockReset();
	findThesisWithRelations.mockResolvedValue(undefined);
});

test("malformed IDs and unsupported slugs never reach the database", async () => {
	expect(await getThesisContext("btc-call", reader)).toEqual({ available: false, reason: "not_found" });
	expect(await getThesisContext("' OR true --", reader)).toEqual({ available: false, reason: "not_found" });
	expect(findThesisWithRelations).not.toHaveBeenCalled();
});

test("missing UUID returns not_found after exactly one read of that id", async () => {
	expect(await getThesisContext(thesisId, reader)).toEqual({ available: false, reason: "not_found" });
	expect(findThesisWithRelations).toHaveBeenCalledTimes(1);
	expect(findThesisWithRelations.mock.calls[0]?.[0]).toBe(thesisId);
});

test("a text-only post uses the package's no_structure reason", async () => {
	findThesisWithRelations.mockResolvedValue({ thesis: { ...textOnlyThesis, id: thesisId }, creator, creatorPosition: null });
	expect(await getThesisContext(thesisId, reader)).toEqual({
		available: false, reason: "no_structure", thesisId, status: "open",
	});
});

test("draft availability remains owned by the package", async () => {
	findThesisWithRelations.mockResolvedValue({ thesis: { ...textOnlyThesis, id: thesisId, status: "draft" }, creator, creatorPosition: null });
	expect(await getThesisContext(thesisId, reader)).toEqual({
		available: false, reason: "no_structure", thesisId, status: "draft",
	});
});

test("query failure does not become a false not_found result", async () => {
	findThesisWithRelations.mockRejectedValue(new Error("offline database failure"));
	await expect(getThesisContext(thesisId, reader)).rejects.toThrow("offline database failure");
});
