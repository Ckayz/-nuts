import { expect, test } from "bun:test";
import { isUniqueViolation, validateProfile } from "./validation";

test("normalizes handle and preserves display name/bio", () => {
	expect(validateProfile({ handle: "Alice_1", displayName: "Alice", bio: "Hello" })).toEqual({ fields: { handle: "alice_1", displayName: "Alice", bio: "Hello" } });
});
test("empty clears; omitted fields remain omitted", () => {
	expect(validateProfile({ handle: "", bio: "" })).toEqual({ fields: { handle: null, bio: null } });
	expect(validateProfile({ displayName: undefined })).toEqual({ fields: {} });
});
test("rejects invalid handles including boundary and routing input", () => {
	for (const handle of ["a-b", "a b", "a/b", " alice", "é", "a".repeat(33), "\n"]) expect(validateProfile({ handle })).toEqual({ error: "invalid_handle" });
	expect(validateProfile({ handle: "a".repeat(32) })).toEqual({ fields: { handle: "a".repeat(32) } });
});
test("rejects malformed payloads and PostgreSQL-invalid NUL", () => {
	for (const input of [null, [], "x", { handle: null }, { bio: 2 }, { displayName: "a\0" }]) expect(validateProfile(input)).toEqual({ error: "invalid_profile" });
});
test("does not forward caller identity or arbitrary fields", () => {
	expect(validateProfile({ userId: "other", walletAddress: "other", handle: "a" })).toEqual({ fields: { handle: "a" } });
});
test("recognizes direct and drizzle-wrapped unique errors only", () => {
	expect(isUniqueViolation({ code: "23505" })).toBe(true);
	expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
	for (const error of [null, "23505", { code: "23514" }, new Error("offline")]) expect(isUniqueViolation(error)).toBe(false);
});
