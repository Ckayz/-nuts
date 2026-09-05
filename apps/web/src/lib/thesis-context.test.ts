/// <reference types="bun" />
import { beforeEach, expect, mock, test } from "bun:test";

// Replace only the database boundary; availability rules run from @nuts/db.
const findFirst = mock(async (_config: unknown): Promise<unknown> => undefined);
mock.module("server-only", () => ({}));
mock.module("@nuts/db", () => ({ db: { query: { theses: { findFirst } } } }));
const { getThesisContext } = await import("./thesis-context");
const thesisId = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
	findFirst.mockReset();
	findFirst.mockResolvedValue(undefined);
});

test("malformed IDs and unsupported slugs do not query PostgreSQL", async () => {
	expect(await getThesisContext("btc-call")).toEqual({ available: false, reason: "not_found" });
	expect(await getThesisContext("' OR true --")).toEqual({ available: false, reason: "not_found" });
	expect(findFirst).not.toHaveBeenCalled();
});

test("missing UUID returns not_found and loads the referenced relations", async () => {
	expect(await getThesisContext(thesisId)).toEqual({ available: false, reason: "not_found" });
	expect(findFirst).toHaveBeenCalledTimes(1);
	const config = findFirst.mock.calls[0]?.[0] as {
		where: (table: { id: string }, ops: { eq: typeof mockEq }) => unknown;
		with: unknown;
	};
	const mockEq = mock((column: string, value: string) => ({ column, value }));
	expect(config.with).toEqual({ creator: true, creatorPosition: true });
	expect(config.where({ id: "theses.id" }, { eq: mockEq })).toEqual({ column: "theses.id", value: thesisId });
});

test("missing creator position uses the package's unavailable reason", async () => {
	findFirst.mockResolvedValue({ id: thesisId, status: "pending", creator: {}, creatorPosition: null });
	expect(await getThesisContext(thesisId)).toEqual({
		available: false, reason: "no_creator_position", thesisId, status: "pending",
	});
});

test("draft availability remains owned by the package", async () => {
	findFirst.mockResolvedValue({ id: thesisId, status: "draft", creator: {}, creatorPosition: null });
	expect(await getThesisContext(thesisId)).toEqual({
		available: false, reason: "not_published", thesisId, status: "draft",
	});
});

test("query failure does not become a false not_found result", async () => {
	findFirst.mockRejectedValue(new Error("offline database failure"));
	await expect(getThesisContext(thesisId)).rejects.toThrow("offline database failure");
});
