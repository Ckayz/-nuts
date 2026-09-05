/**
 * D-n3 (lane D confirming pass). The reviewer's exact scenario, end to end:
 * ONE post by a creator the viewer follows, and NOTHING settled. The Following
 * + Settled tab used to print "Nobody you follow has posted a thesis yet.",
 * which the post on the Trending tab disproves.
 *
 * This drives the real `CalloutTabs` through the hook runner — clicking the
 * tab and the pill — because the bug was in what the component PASSES to the
 * copy, not in the copy function alone.
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { mount } from "@/test/hook-runner";
import { CalloutTabs } from "./callout-tabs";
import { AUDIENCE_FOLLOWING, RANKING_SETTLED, feedEmptyState } from "./empty-state";
import type { Thesis } from "@/lib/display-types";

const creator = {
	id: "u1", walletAddress: "0x00000000000000000000000000000000000000aa",
	displayName: "merkle_mike", handle: "merkle_mike", initials: "MK", avatarSeed: "u1",
	mockWalletFragment: null, sinceLabel: null, winRatePct: null, thesesCount: null,
	followers: null, netPnlUsd: null, verifiedPnl30dUsd: null, biggestLossUsd: null,
} as unknown as Thesis["creator"];

const post = {
	id: "t1", slug: "s1", headline: "ETH holds 2400 into Friday", note: null, creator,
	asset: "ETH", status: "live", statusLabel: "LIVE", postedLabel: "· 18m",
	tag: null, structure: null, backing: null, likes: 0, likedByViewer: false, commentCount: 0,
} as unknown as Thesis;

/** Pick a tab through the `onSelect` the component passed to its tab strip. */
function select(view: ReturnType<typeof mount>, firstLabel: string, index: number): void {
	const strip = view.find(
		(element) => Array.isArray(element.props.labels) && (element.props.labels as string[])[0] === firstLabel,
	);
	expect(strip, firstLabel).toHaveLength(1);
	const onSelect = strip[0]?.props.onSelect;
	if (typeof onSelect !== "function") throw new Error(`no onSelect on the ${firstLabel} strip`);
	(onSelect as (next: number) => void)(index);
	view.flush();
}

/** The empty-state element `CalloutTabs` rendered, rendered for real. */
function emptyLine(view: ReturnType<typeof mount>): string {
	const found = view.find((element) => typeof element.type === "function" && "audience" in element.props);
	expect(found).toHaveLength(1);
	const element = found[0];
	if (element === undefined) throw new Error("no empty state rendered");
	const Component = element.type as (props: Record<string, unknown>) => ReactElement;
	return renderToStaticMarkup(Component(element.props));
}

test("D-n3: Following + Settled with a followed post present does not claim nobody has posted", () => {
	const view = mount(CalloutTabs as unknown as (props: never) => ReactElement, {
		ranked: { trending: [post], ending: [], settled: [] },
		following: [post],
		top: [],
		signedIn: true,
		databaseMode: true,
	});
	// The post IS there on the Trending tab, which is what makes the old line false.
	expect(view.find((element) => typeof element.type === "function" && "audience" in element.props)).toHaveLength(0);

	// The tab strips are components, so the runner drives them the way the real
	// buttons do: through the `onSelect` the component handed them.
	select(view, "All", 1); // Following
	select(view, "Trending", 2); // Settled

	const html = emptyLine(view);
	expect(html).toContain("Nothing settled from creators you follow right now.");
	// The claims the component cannot support.
	expect(html).not.toContain("has posted");
	expect(html).not.toContain("first thesis");
	// And it is the copy function's own line, reached with the selected indices.
	expect(html).toContain(feedEmptyState(AUDIENCE_FOLLOWING, RANKING_SETTLED).line);
});

test("D-n3: every empty line only says the selection is empty", () => {
	for (let audience = 0; audience < 3; audience += 1) {
		for (let ranking = 0; ranking < 3; ranking += 1) {
			const { line, action } = feedEmptyState(audience, ranking);
			const where = `${audience}/${ranking}`;
			expect(line, where).toStartWith("Nothing ");
			// No claim about what anybody has or has not done, or about the
			// database as a whole.
			for (const claim of ["posted", "has settled", "yet", "first", "nobody", "Nobody", "No top trader"]) {
				expect(line, `${where}: "${claim}"`).not.toContain(claim);
			}
			expect(action, where).not.toContain("first");
		}
	}
});

test("D-n3: the nine pairs are nine distinct lines, so the tabs stay distinguishable", () => {
	const lines = new Set<string>();
	for (let audience = 0; audience < 3; audience += 1) {
		for (let ranking = 0; ranking < 3; ranking += 1) lines.add(feedEmptyState(audience, ranking).line);
	}
	expect(lines.size).toBe(9);
});
