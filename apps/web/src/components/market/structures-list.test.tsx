/**
 * C#6. The structures table's "Select" must navigate whenever the rows name
 * real structures — including on the missing-structure recovery page, whose own
 * copy tells the visitor to pick another one from this list.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StructuresList } from "./structures-list";
import type { MarketStructure } from "@/lib/display-types";

const money = (raw: string) => ({ raw, usd: raw, usd2: raw, signed2: raw, pnlClass: "" }) as unknown as MarketStructure["premiumPerContractUsd"];

const rows: MarketStructure[] = [
	{
		id: "available-b",
		expiryLabel: "05 Sep",
		productType: "put spread",
		strikesLabel: "2,500 / 2,450 P",
		premiumPerContractUsd: money("1.00"),
		maxPayoutLabel: "$50.00",
		liquidityLeftUsd: money("100"),
		selected: false,
	} as unknown as MarketStructure,
];

function render(live: boolean): string {
	return renderToStaticMarkup(StructuresList({ rows, slug: "eth", query: { thesis: "t1" }, live }));
}

describe("StructuresList (C#6)", () => {
	test("live rows render Select as a link that carries the query", () => {
		const html = render(true);
		expect(html).toContain('href="/m/eth?thesis=t1&amp;structure=available-b"');
		expect(html).toContain("Select");
	});

	test("fixture rows keep the inert button — there is nowhere for it to go", () => {
		const html = render(false);
		expect(html).not.toContain("href=");
		expect(html).toContain("<button");
	});

	test("without a slug there is no destination, even when live", () => {
		const html = renderToStaticMarkup(StructuresList({ rows, live: true }));
		expect(html).not.toContain("href=");
	});
});

describe("C#6: the route asks the LIST whether it can navigate, not the ticket", () => {
	test("the missing-structure branch returns selectable: true with trade: null", async () => {
		const source = await Bun.file(new URL("../../lib/market/page.ts", import.meta.url)).text();
		const branch = source.slice(source.indexOf("if (page.requestedStructureMissing)"));
		expect(branch).toContain("trade: null,");
		expect(branch.slice(0, branch.indexOf("unavailable: STRUCTURE_UNAVAILABLE"))).toContain("selectable: true,");
	});

	test("the route passes `selectable`, never `trade !== null`", async () => {
		const route = await Bun.file(new URL("../../app/m/[asset]/page.tsx", import.meta.url)).text();
		const list = route.slice(route.indexOf("<StructuresList"));
		expect(list.slice(0, list.indexOf("/>"))).toContain("live={selectable}");
		expect(list.slice(0, list.indexOf("/>"))).not.toContain("trade !== null");
	});
});
