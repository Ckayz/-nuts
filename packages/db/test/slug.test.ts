import { expect, test } from "bun:test";
import { deriveSlug, slugPrefix } from "../src/slug";
import { slugCases } from "./fixtures/slug";

const id = "abcd0000-0000-4000-8000-000000000001";
for (const [headline, prefix] of slugCases) {
  test(`slug normalization ${JSON.stringify(headline)}`, () => {
    expect(slugPrefix(headline)).toBe(prefix);
    expect(deriveSlug(headline, id)).toBe(prefix ? `${prefix}-abcd` : id.replaceAll("-", ""));
  });
}
test("collisions extend to the last UUID digit without losing uniqueness", () => {
  const occupied = new Set<string>();
  for (let n = 0; n < 64; n++) {
    const uuid = `abcd0000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
    const slug = deriveSlug("same headline", uuid, occupied);
    expect(occupied.has(slug)).toBe(false);
    expect(slug).toMatch(/^same-headline-[a-f0-9]{4,32}$/);
    occupied.add(slug);
  }
  expect(occupied.size).toBe(64);
  expect([...occupied].some(slug => slug.length === "same-headline-".length + 32)).toBe(true);
});
test("empty-prefix namespace and malformed IDs", () => {
  expect(deriveSlug("🔥", id)).not.toContain("-");
  expect(() => deriveSlug("a", "not-a-uuid")).toThrow("UUID");
  expect(() => deriveSlug("🔥", id, new Set([id.replaceAll("-", "")]))).toThrow("occupied");
});
