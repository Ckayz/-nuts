/**
 * D-C2 (lane D confirming pass). Every sentence the agent surface shows is the
 * owner's to word, so every one of them carries a `TODO-OWNER` marker.
 *
 * The mockup draws no agent view and the PRD sets no wording for one, so none
 * of this copy has provenance. The reviewer measured zero `TODO-OWNER` in
 * either component:
 *   {"path":"…/trade-approval.tsx","ownerTags":0,"example":"Prepare this trade?"}
 *   {"path":"…/trade-execution.tsx","ownerTags":0,"example":"Confirmed on Base and recorded."}
 *
 * These tests are a fence, not a formality: they fail when a new literal is
 * introduced outside the tagged `COPY` block, which is exactly how the untagged
 * strings got in.
 */
import { describe, expect, test } from "bun:test";

const read = async (name: string) => Bun.file(new URL(name, import.meta.url)).text();

describe("D-C2: the agent's copy is tagged", () => {
	test("trade-approval.tsx tags every sentence it prints", async () => {
		const source = await read("./trade-approval.tsx");
		expect(source.match(/TODO-OWNER/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
		// The reviewer's two examples specifically.
		for (const phrase of ["Prepare this trade?", "Spend up to"]) {
			expect(source).toContain(phrase);
		}
		// And the marker is rendered, not only written in a comment.
		expect(source).toContain("<TodoOwner />");
	});

	test("trade-execution.tsx holds every sentence in one tagged block", async () => {
		const source = await read("./trade-execution.tsx");
		expect(source).toContain("const COPY = {");
		expect(source).toContain("<TodoOwner />");
		// The reviewer's example.
		expect(source).toContain("Confirmed on Base and recorded.");
	});

	/**
	 * The fence. Every `setMessage` argument must be a COPY reference or a
	 * template built from one — never a bare literal, which is how twenty
	 * untagged sentences accumulated.
	 */
	test("no setMessage in trade-execution.tsx takes a bare string literal", async () => {
		const source = await read("./trade-execution.tsx");
		const bare = [...source.matchAll(/setMessage\(\s*"(?!\)\s*)/g)];
		expect(bare.map((match) => source.slice(match.index, (match.index ?? 0) + 60))).toEqual([]);
	});

	/**
	 * EVERY top-level entry carries its OWN `TODO-OWNER` comment, so the gap
	 * between one entry and the next must contain one. A looser "somewhere
	 * above" rule let a new entry inherit its neighbour's tag — measured, so the
	 * rule is exact instead.
	 */
	test("every COPY entry is documented as the owner's", async () => {
		const source = await read("./trade-execution.tsx");
		const block = source.slice(source.indexOf("const COPY = {"), source.indexOf("} as const;"));
		const entries = [...block.matchAll(/^\t(\w+):/gm)];
		expect(entries.length).toBeGreaterThan(15);
		const undocumented: string[] = [];
		let previousEnd = block.indexOf("{") + 1;
		for (const entry of entries) {
			const at = entry.index ?? 0;
			if (!block.slice(previousEnd, at).includes("TODO-OWNER")) undocumented.push(entry[1] ?? "?");
			previousEnd = at + entry[0].length;
		}
		expect(undocumented).toEqual([]);
	});
});
