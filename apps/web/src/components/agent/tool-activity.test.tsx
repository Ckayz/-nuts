/**
 * Follow-up 2 (`.research/rfq/followups.md`, measured in the 2026-09-06 11:3x
 * browser walk): "RFQ tool activity shows the raw tool name."
 *
 * `ToolActivity` printed "Checking market prices" for the four tools that had a
 * label and fell through to `part.type.replace(/^tool-/, "")` for the rest, so a
 * turn that priced a custom request showed the reader the string
 * `buildCustomRfqPreview`.
 *
 * The fence is the interesting half: a label map is exactly the kind of thing
 * that goes stale when a tool is added, so the test reads the SAME list the
 * request schema builds its part types from (`AGENT_TOOL_NAMES`, itself pinned
 * against the four tool modules by `lib/agent/request.test.ts`).
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AGENT_TOOL_NAMES } from "@/lib/agent/request";
import { TOOL_ACTIVITY_LABELS, ToolActivity } from "./tool-activity";

test("every tool the agent can call has a sentence, not a camelCase name", () => {
	const missing = AGENT_TOOL_NAMES.filter((name) => TOOL_ACTIVITY_LABELS[`tool-${name}`] === undefined);
	console.log("MISSING_LABELS", JSON.stringify(missing));
	expect(missing).toEqual([]);
});

test("no label is the tool's own name, and none is empty", () => {
	for (const name of AGENT_TOOL_NAMES) {
		const label = TOOL_ACTIVITY_LABELS[`tool-${name}`] ?? "";
		expect(label, name).not.toBe(name);
		expect(label.length, name).toBeGreaterThan(0);
		// A sentence, not an identifier: no camelCase run survives.
		expect(label, name).not.toMatch(/[a-z][A-Z]/);
	}
});

test("the six tools the follow-up named render their sentence", () => {
	// The reviewer's own example first.
	const html = renderToStaticMarkup(
		<ToolActivity part={{ type: "tool-buildCustomRfqPreview", state: "input-available" }} />,
	);
	console.log("RFQ_PREVIEW", html);
	expect(html).toContain("Previewing the custom request…");
	expect(html).not.toContain("buildCustomRfqPreview");

	for (const [type, sentence] of [
		["tool-getUserPositions", "Reading your positions"],
		["tool-whatIfAtExpiry", "Working out the payoff at that price"],
		["tool-suggestRfqReservePrice", "Reading maker prices"],
		["tool-getRfqStatus", "Checking your request"],
		["tool-listMyRfqs", "Listing your requests"],
	] as const) {
		const done = renderToStaticMarkup(<ToolActivity part={{ type, state: "output-available" }} />);
		expect(done, type).toContain(sentence);
		expect(done, type).not.toContain(type.replace(/^tool-/, ""));
	}
});

test("a failed lookup says so with the same sentence", () => {
	const html = renderToStaticMarkup(
		<ToolActivity part={{ type: "tool-getRfqStatus", state: "output-error" }} />,
	);
	expect(html).toContain("Checking your request — failed");
});

test("every sentence is the owner's to word", async () => {
	const source = await Bun.file(new URL("./tool-activity.tsx", import.meta.url)).text();
	expect(source).toContain("TODO-OWNER");
	// Nothing outside the one map builds a sentence.
	const afterMap = source.slice(source.indexOf("};", source.indexOf("TOOL_ACTIVITY_LABELS")));
	expect(afterMap).not.toMatch(/"[A-Z][a-z]+ [a-z]/);
});
