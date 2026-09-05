/**
 * D-minor (lane D pass 2): an unbroken name or headline must not push the page
 * sideways.
 *
 * The reviewer measured that 400 `W`s are ACCEPTED and reach the markup
 * (`{"acceptedDisplayName":true,"nameUnbroken":true,"headlineUnbroken":true}`)
 * but stopped short of rendering: "horizontal pixel overflow is NOT VERIFIED
 * without rendering". It was verified here, in a headless Chromium at 390 px
 * against a db-mode `next dev` whose feed carried a user whose display name,
 * headline and rationale were each 400 `W`s:
 *
 *   BEFORE  {"viewport":390,"docScrollWidth":5869,"horizontalOverflow":true,
 *            "overflowingElements":["post:5855>362","post-main:5801>306",
 *                                   "p-head:5794>306","p-body:5801>306"]}
 *   AFTER   {"viewport":390,"docScrollWidth":390,"horizontalOverflow":false,
 *            "overflowingElements":[]}
 *
 * That probe needs a browser, a server and a seeded database, so it is not a
 * unit test. What this file pins is the three rules the probe proved, so a
 * later edit cannot quietly drop one — the same shape `page-frame.test.tsx`,
 * `status-chip.test.tsx` and `fomo-layout.test.tsx` already use for CSS.
 *
 * No content limit is asserted anywhere: how long a name or a headline may be
 * is the owner's number, and wrapping is the fix that invents none.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

/**
 * The declaration block of the FIRST rule whose selector list contains
 * `selector`. Written as a scan rather than a regular expression because the
 * selector may sit anywhere in a comma-separated list.
 */
function rule(selector: string): string {
	const at = css.indexOf(selector);
	if (at === -1) return "";
	const open = css.indexOf("{", at);
	const close = css.indexOf("}", open);
	if (open === -1 || close === -1) return "";
	// The text must be part of THIS rule's selector, not of some other rule's
	// declarations: a `}` between them would mean the match was inside a body.
	if (css.slice(at, open).includes("}")) return "";
	return css.slice(open + 1, close);
}

test("the rule finder really finds a rule (so the assertions below cannot pass vacuously)", () => {
	// `.p-handle,.p-time` carried this rule before the fold; it is the model the
	// three below copy.
	expect(rule(".p-handle")).toContain("overflow-wrap:anywhere");
	expect(rule(".p-handle")).toContain("min-width:0");
	expect(rule(".no-such-class-anywhere")).toBe("");
});

test("a post's NAME wraps anywhere and may shrink below its min-content width", () => {
	expect(rule(".p-name{")).toContain("overflow-wrap:anywhere");
	expect(rule(".p-name{")).toContain("min-width:0");
});

test("a post's BODY wraps anywhere", () => {
	expect(rule(".p-body{")).toContain("overflow-wrap:anywhere");
});

test("the share card's owner name wraps anywhere and may shrink", () => {
	expect(rule(".sc-name{")).toContain("overflow-wrap:anywhere");
	expect(rule(".sc-name{")).toContain("min-width:0");
});
