import { expect, test } from "bun:test";

test("schema imports without database or environment initialization", async () => {
  const schema = await import("../src/schema");
  expect(schema.users).toBeDefined();
  expect(schema.theses).toBeDefined();
  expect(schema.positions).toBeDefined();
});
