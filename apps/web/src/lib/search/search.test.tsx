import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { allCreators, merkleMike } from "@/mock/data";
import { marketSummaries } from "../view-data";
import { escapeLike, normalizeQuery, SEARCH_QUERY_LIMIT, searchMarkets, searchMockPeople } from "./query";
import { searchKey } from "./keyboard";
import { SearchList } from "@/components/shell/search";

test("normalization and literal SQL pattern escaping", () => {
 expect(normalizeQuery("  BTC  ")).toBe("btc");
 for (const value of [null, {}, 123, "", "  ", "a".repeat(SEARCH_QUERY_LIMIT + 1)]) expect(normalizeQuery(value)).toBeNull();
 expect(normalizeQuery("a".repeat(SEARCH_QUERY_LIMIT))).toHaveLength(SEARCH_QUERY_LIMIT);
 expect(escapeLike("a%_\\b")).toBe("a\\%\\_\\\\b");
});
test("mock market ticker and known name matches", () => {
 expect(searchMarkets("bt", marketSummaries).map(row => row.asset)).toContain("BTC");
 expect(searchMarkets("bit", [{ slug: "btc", asset: "BTC", name: "Bitcoin" }])).toHaveLength(1);
 expect(searchMarkets("no-such-market", marketSummaries)).toEqual([]);
});
test("mock handle prefix, name substring and literal wildcard matching", () => {
 expect(searchMockPeople("merkle", allCreators).map(row => row.handle)).toContain("merkle_mike");
 expect(searchMockPeople("rkle", allCreators).map(row => row.handle)).toContain("merkle_mike");
 expect(searchMockPeople("mike", [{ ...merkleMike, displayName: null }])).toEqual([]);
 for (const query of ["%", "\\", "no-such-person"]) expect(searchMockPeople(query, allCreators)).toEqual([]);
 expect(searchMockPeople("merkle_", allCreators)).toHaveLength(1);
});
test("wallet prefix needs four hex digits, full route and shortened unnamed identity", () => {
 const address = `0xabcd${"0".repeat(36)}`;
 const people = [{ ...merkleMike, walletAddress: address, handle: address, displayName: null }];
 for (const query of ["0x", "0xabc", "0xabcz", "abcd"]) expect(searchMockPeople(query, people)).toEqual([]);
 const result = searchMockPeople(normalizeQuery(" 0xABCD ")!, people)[0]!;
 expect(result.href).toBe(`/u/${address}`);
 expect(result.displayName).toBe("0xabcd…0000");
 expect(result.handleLabel).toBe("0xabcd…0000");
});
test("keyboard navigation wraps, opens first by default, closes and leaves Tab alone", () => {
 expect(searchKey("ArrowDown", -1, 2)).toBe(0);
 expect(searchKey("ArrowUp", -1, 2)).toBe(1);
 expect(searchKey("ArrowDown", 1, 2)).toBe(0);
 expect(searchKey("ArrowUp", 0, 2)).toBe(1);
 expect(searchKey("Enter", -1, 2)).toBe("open");
 expect(searchKey("Escape", -1, 0)).toBe("close");
 expect(searchKey("Enter", -1, 0)).toBeNull();
 expect(searchKey("Tab", 0, 2)).toBeNull();
});
test("listbox groups and links have matching IDs and selection", () => {
 const html = renderToStaticMarkup(<SearchList id="results" optionPrefix="search" selected={1} onChoose={() => {}}
  results={{ markets: [{ slug: "btc", asset: "BTC", name: "Bitcoin" }], people: searchMockPeople("merkle", allCreators) }} />);
 expect(html).toContain('role="listbox"');
 expect(html).toContain('role="group" aria-label="Markets"');
 expect(html).toContain('role="group" aria-label="People"');
 expect(html).toContain('id="search-option-1" aria-selected="true"');
 expect(html.match(/role="option"/g)).toHaveLength(2);
 expect(html).toContain('href="/m/btc"');
 expect(html).toContain('href="/u/merkle_mike"');
});
test("no matches and failure are distinct status lines", () => {
 const render = (unavailable: boolean) => renderToStaticMarkup(<SearchList id="r" optionPrefix="s" selected={-1} onChoose={() => {}} results={{ markets: [], people: [], unavailable }} />);
 expect(render(false)).toContain("No matching markets or people.");
 expect(render(true)).toContain("Search is unavailable. Try again.");
});

function actionProbe(mode: "mock" | "db", script: string) {
 const child = Bun.spawnSync([process.execPath, "--preload", "./test/setup.ts", "-e", script], {
  cwd: new URL("../../..", import.meta.url).pathname,
  env: { ...process.env, NODE_ENV: "test", DATA_SOURCE: mode, DATABASE_URL: "", SKIP_ENV_VALIDATION: "1" }, stdout: "pipe", stderr: "pipe",
 });
 expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({ code: 0, stderr: "" });
 return JSON.parse(child.stdout.toString());
}
test("actual mock action uses fixtures and rejects invalid input without network", () => {
 const result = actionProbe("mock", `
  globalThis.fetch = async () => { throw new Error("unexpected network"); };
  const { searchAll } = await import("./src/lib/search/actions.ts");
  console.log(JSON.stringify(await Promise.all([searchAll(" BT "), searchAll("merkle"), searchAll("no-such-person"), searchAll(null)])));
 `);
 expect(result[0].markets.map((row: {asset: string}) => row.asset)).toContain("BTC");
 expect(result[1].people[0].href).toBe("/u/merkle_mike");
 expect(result[2]).toEqual({ markets: [], people: [] });
 expect(result[3]).toEqual({ markets: [], people: [] });
});
test("action hides partial results on either feed or database failure", () => {
 for (const failure of ["feed", "database"]) {
  const result = actionProbe("db", `
   import { plugin } from "bun";
   globalThis.fetch = async () => { throw new Error("unexpected network"); };
   plugin({ name: "search-failure", setup(build) {
    build.module("@/lib/market/summaries", () => ({ loader: "object", exports: { marketSummariesData: async () => ({ markets: [{slug:"btc", asset:"BTC", name:"BTC"}], unavailable: ${failure === "feed"} }) } }));
    build.module("@/lib/search/reads", () => ({ loader: "object", exports: { searchPeople: async () => { ${failure === "database" ? 'throw new Error("database offline");' : 'return [];'} } } }));
   }});
   const { searchAll } = await import("./src/lib/search/actions.ts");
   console.log(JSON.stringify(await searchAll("bt")));
  `);
  expect(result).toEqual({ markets: [], people: [], unavailable: true });
 }
});
