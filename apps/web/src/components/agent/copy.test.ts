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
	 * D-N3 (lane D confirming pass). D-C2 tagged the approval and execution
	 * components and stopped there, so three sentences in the chat itself stayed
	 * untagged. The reviewer measured `OWNER_TAGS {"renderedMarkers":0,
	 * "sourceTagLines":[27,46,356]}` — markers existed in the file, none of them
	 * covering these. A marker elsewhere in a file is not approval.
	 */
	test("agent-chat.tsx holds its loose sentences in one tagged block", async () => {
		const source = await read("./agent-chat.tsx");
		expect(source).toContain("const COPY = {");
		// The reviewer's three sentences, each now a COPY entry, plus W4's
		// composer guard — the one thing the chat says that is not a reply.
		for (const phrase of [
			"Live Thetanuts liquidity on Base. It prepares trades; your wallet approves them.",
			"Ask about options, markets, or what a small budget could buy.",
			"Something went wrong. Try sending that again.",
			"Answer the card above first.",
		]) {
			expect(source).toContain(phrase);
			// and reached through COPY, not printed as a bare literal in the JSX.
			expect(source).not.toContain(`>\n\t\t\t\t\t\t${phrase}`);
		}
		// Every entry documented, same rule as trade-execution.tsx below.
		const block = source.slice(source.indexOf("const COPY = {"), source.indexOf("} as const;"));
		const entries = [...block.matchAll(/^\t(\w+):/gm)];
		// W4 raised this from 3 to 4 DELIBERATELY: `awaitingApproval` is the
		// composer guard's sentence (follow-up 1). The fence's job is to make a
		// new sentence a visible decision, which is exactly what happened here.
		expect(entries.length).toBe(4);
		let previousEnd = block.indexOf("{") + 1;
		const undocumented: string[] = [];
		for (const entry of entries) {
			const at = entry.index ?? 0;
			if (!block.slice(previousEnd, at).includes("TODO-OWNER")) undocumented.push(entry[1] ?? "?");
			previousEnd = at + entry[0].length;
		}
		expect(undocumented).toEqual([]);
		// And each of the three prints a rendered marker beside it.
		//
		// F-E: the error line now reads `{agentErrorMessage(error, COPY.error)}`,
		// because the server usually knows WHICH failure happened and says so —
		// `COPY.error` is the fallback for anything the server did not word. The
		// fence is unchanged in strength: a COPY reference still has to be the last
		// thing before the rendered marker.
		// Four now: the guard prints its sentence with a marker as well, so the
		// placeholder attribute is not the only place it appears.
		expect(source.match(/COPY\.\w+[^\n]*\} <TodoOwner \/>/g)?.length ?? 0).toBe(4);
	});

	/**
	 * The RFQ card is `trade-execution.tsx`'s sibling and gets the same fence: one
	 * tagged block, every entry documented, and no `setMessage` anywhere in the
	 * file taking a bare literal. The block is bigger than the trade card's
	 * because the RFQ path has more states (watching, cancelling, settling), which
	 * is exactly where an untagged sentence would hide.
	 */
	test("rfq-execution.tsx holds every sentence in one tagged block", async () => {
		const source = await read("./rfq-execution.tsx");
		expect(source).toContain("const COPY = {");
		expect(source).toContain("<TodoOwner />");
		const block = source.slice(source.indexOf("const COPY = {"), source.indexOf("} as const;"));
		const entries = [...block.matchAll(/^\t(\w+):/gm)];
		expect(entries.length).toBeGreaterThan(20);
		const undocumented: string[] = [];
		let previousEnd = block.indexOf("{") + 1;
		for (const entry of entries) {
			const at = entry.index ?? 0;
			if (!block.slice(previousEnd, at).includes("TODO-OWNER")) undocumented.push(entry[1] ?? "?");
			previousEnd = at + entry[0].length;
		}
		expect(undocumented).toEqual([]);
	});

	test("no setMessage in rfq-execution.tsx takes a bare string literal", async () => {
		const source = await read("./rfq-execution.tsx");
		const bare = [...source.matchAll(/setMessage\(\s*"(?!\)\s*)/g)];
		expect(bare.map((match) => source.slice(match.index, (match.index ?? 0) + 60))).toEqual([]);
	});

	test("rfq-approval.tsx tags every sentence it prints", async () => {
		const source = await read("./rfq-approval.tsx");
		expect(source.match(/TODO-OWNER/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
		expect(source).toContain("<TodoOwner />");
		// The two headings a reviewer greps for.
		for (const phrase of ["Ask market makers for this option?", "Most per contract"]) {
			expect(source).toContain(phrase);
		}
	});

	/**
	 * F-E. The five sentences the server may put on the screen live in one tagged
	 * block too, for the same reason the three above do: nobody has worded them
	 * but this repo, and a sixth must not slip in untagged.
	 */
	test("the server's failure sentences are one tagged block", async () => {
		const source = await Bun.file(new URL("../../lib/agent/errors.ts", import.meta.url)).text();
		const start = source.indexOf("export const AGENT_ERROR_SENTENCES");
		expect(start).toBeGreaterThan(-1);
		// The tag sits in the doc comment immediately above the block.
		expect(source.slice(Math.max(0, start - 400), start)).toContain("TODO-OWNER");
		const block = source.slice(start, source.indexOf("};", start));
		const entries = [...block.matchAll(/^\t(\w+):/gm)].map((m) => m[1]);
		expect(entries).toEqual(["model_not_found", "no_credit", "rate_limited", "provider_down", "unknown"]);
		// Not one of them names a provider, a model or a status code.
		for (const forbidden of ["OpenRouter", "Vercel", "gateway", "401", "402", "429", "anthropic"]) {
			expect(block, forbidden).not.toContain(forbidden);
		}
	});

	/**
	 * D-n6. Colour in this app is for money only, and shadcn's `destructive` is
	 * a chromatic red (`--destructive: oklch(0.58 0.22 27)` in
	 * `packages/ui/src/styles/globals.css`). No agent surface may reach for it.
	 */
	test("no agent component paints an error red", async () => {
		for (const name of ["./agent-chat.tsx", "./trade-execution.tsx", "./trade-approval.tsx", "./tool-activity.tsx", "./agent-launcher.tsx", "./agent-markdown.tsx", "./rfq-execution.tsx", "./rfq-approval.tsx"]) {
			expect(await read(name), name).not.toContain("text-destructive");
		}
		// The neutral replacement exists and is the ticket's own idiom.
		const css = await Bun.file(new URL("../../styles/agent.css", import.meta.url)).text();
		expect(css).toContain(".agent-msg{");
		expect(css).toContain("color:var(--muted)");
		// D-n6: ordinary market links are body text, not the accent.
		expect(css).toContain(".agent-md-link{color:var(--text);text-decoration:underline");
		expect(css).not.toContain("agent-md-link{color:var(--accent");
	});

	/**
	 * The chip copy lives in `lib/agent/suggestions.ts`, not in a component: the
	 * same sentence is both a label and the message pressing it sends, and both
	 * the chat and the market panel render it. It gets the same fence as the
	 * components — every entry documented as the owner's, or citing the PRD
	 * section that already words it.
	 *
	 * Written when the row became model-driven (owner 2026-09-06 05:4x): that
	 * added the starters, the never-empty fallback and the post-fill chips, and
	 * a block this size is exactly where an untagged sentence hides.
	 */
	test("every chip sentence is tagged, or quotes the PRD", async () => {
		const source = await Bun.file(new URL("../../lib/agent/suggestions.ts", import.meta.url)).text();
		const block = source.slice(source.indexOf("const COPY = {"), source.indexOf("} as const;"));
		const entries = [...block.matchAll(/^\t(\w+):/gm)];
		expect(entries.length).toBeGreaterThan(29);
		const undocumented: string[] = [];
		let previousEnd = block.indexOf("{") + 1;
		for (const entry of entries) {
			const at = entry.index ?? 0;
			const gap = block.slice(previousEnd, at);
			if (!gap.includes("TODO-OWNER") && !gap.includes("PRD 10.7")) undocumented.push(entry[1] ?? "?");
			previousEnd = at + entry[0].length;
		}
		expect(undocumented).toEqual([]);
		// And no sentence is built outside the block: every chip label and every
		// `send` in the file reaches through COPY.
		const afterBlock = source.slice(source.indexOf("} as const;"));
		const bareChips = [...afterBlock.matchAll(/(?:label|send):\s*(?:"|`)/g)];
		expect(bareChips.map((m) => afterBlock.slice(m.index, (m.index ?? 0) + 50))).toEqual([]);
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
