import { expect, test } from "bun:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { theses } from "../src/schema/theses";

// Decode the actual SQL set instead of keeping a second JavaScript character list.
// The production JS contract uses ECMA-262 TrimString in src/ai-context.ts.
test("SQL headline predicate agrees with JavaScript trim on 20 inputs", async () => {
  const constraint = getTableConfig(theses).checks.find((check) => check.name === "theses_headline_nonblank")!;
  const expression = new PgDialect().sqlToQuery(constraint.value).sql;
  const escaped = expression.match(/E'((?:\\u[0-9A-F]{4})+)'/)?.[1];
  expect(escaped).toBeDefined();
  const whitespace = new Set(escaped!.replace(/\\u([0-9A-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))));
  // btrim removes only boundary members; all-whitespace iff every character is a member.
  const sqlPredicate = (headline: string) => [...headline].some((character) => !whitespace.has(character));
  const inputs = ["", " ", "\t\n\v\f\r", "\u00a0", "\u1680", "\u2007", "\ufeff", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000", [...whitespace].join(""), "A normal headline", "Words\u00a0between", "\u00a0word\ufeff", "\u0085", "\u180e", "\u200b", "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2008\u2009\u200a"];
  expect(inputs).toHaveLength(20);
  for (const headline of inputs) expect(sqlPredicate(headline)).toBe(headline.trim().length > 0);
  const migration = await Bun.file(new URL("../src/migrations/0003_thesis_is_a_post.sql", import.meta.url)).text();
  expect(migration).toContain(`CHECK (${expression})`);
  const snapshot = await Bun.file(new URL("../src/migrations/meta/0003_snapshot.json", import.meta.url)).json();
  expect(snapshot.tables["public.theses"].checkConstraints.theses_headline_nonblank.value).toBe(expression);
});
