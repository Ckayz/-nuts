/**
 * The prompt and the parser have to agree.
 *
 * The follow-up chips are a trailer line the model writes inside the answer
 * (`## Follow-ups`), which `lib/agent/suggestions.ts` cuts out again before the
 * text is rendered. Nothing else connects the two files: change the marker in
 * one of them and the failure is silent and ugly — the trailer stops being
 * recognised, so the raw `SUGGEST: [...]` JSON renders at the bottom of every
 * reply and the chips fall back to the generic set forever.
 *
 * These assertions are the join. They are string-level on purpose: the prompt
 * is a string the provider sees, not an object.
 */
import { describe, expect, test } from "bun:test";

import { SUGGEST_MARKER } from "./suggestions";

const { SYSTEM_PROMPT } = await import("./prompt");

describe("the follow-up trailer is specified where it is parsed", () => {
	test("the prompt asks for the exact marker the parser looks for", () => {
		expect(SYSTEM_PROMPT).toContain("## Follow-ups");
		expect(SYSTEM_PROMPT).toContain(`${SUGGEST_MARKER} ["…","…"]`);
	});

	test("the example trailer in the prompt is one the parser accepts", async () => {
		// Not just "the marker appears": the literal example is run through the
		// real parser, with a plausible array in place of the ellipses.
		const { splitSuggestionTrailer } = await import("./suggestions");
		const shape = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf(`${SUGGEST_MARKER} [`));
		const example = shape.slice(0, shape.indexOf("\n")).replace('["…","…"]', '["One","Two"]');
		const { body, chips } = splitSuggestionTrailer(`An answer.\n\n${example}`, false);
		expect(chips.map((c) => c.label)).toEqual(["One", "Two"]);
		expect(body).toBe("An answer.");
	});

	test("the five preferred wordings are PRD 10.7 verbatim", () => {
		// docs/PRD.md 10.7 "Suggested questions". Quoted, not invented, which is
		// why they carry no TODO-OWNER.
		for (const question of [
			"What needs to happen for this position to profit?",
			"What is the maximum loss?",
			"Explain the strikes in simple terms.",
			"What happens at expiry?",
			"How is the Counter side different?",
		]) {
			expect(SYSTEM_PROMPT, question).toContain(question);
		}
	});

	test("the trailer is the last thing the model is told to write", () => {
		expect(SYSTEM_PROMPT.trimEnd().endsWith("Write nothing after that line.")).toBe(true);
	});
});

describe("hedging stays level 1: propose, never promise", () => {
	test("the section exists and is about buying a put", () => {
		expect(SYSTEM_PROMPT).toContain("## Protecting an asset");
		expect(SYSTEM_PROMPT).toContain('side "buy", direction "put"');
	});

	test("the premium is never presented as free protection", () => {
		const section = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf("## Protecting an asset"));
		expect(section).toContain("Never call it insurance that cannot lose");
		expect(section).toContain("the premium is gone");
		// The 10 USD cap governs a hedge exactly as it governs any other buy.
		expect(section).toContain("10 USD cap");
	});

	test("no expiry is recommended, because nothing ranks them", () => {
		// TODO-OWNER: which expiry a hedge should prefer. Until that is decided
		// the prompt must not invent a preference.
		const section = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf("## Protecting an asset"));
		expect(section).toContain("nothing here ranks them");
	});
});
