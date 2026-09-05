import { expect, test } from "bun:test";
import { trending, ending, settled, following, top, theses, thesisDetailBySlug } from "../view-data";
test("every example feed and rail slug resolves to its own detail", () => {
 for (const list of [trending, ending, settled, following, top, theses]) {
  expect(list.length).toBeGreaterThan(0);
  for (const item of list) expect(thesisDetailBySlug(item.slug)?.thesis.slug).toBe(item.slug);
 }
 expect(thesisDetailBySlug("missing-fixture")).toBeUndefined();
});
