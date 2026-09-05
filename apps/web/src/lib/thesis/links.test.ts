import { describe, expect, test } from "bun:test";
import {
	MAX_TRADE_CARDS_PER_POST,
	extractTradeLinks,
	renderTextWithLinks,
	tradeLinkHref,
} from "./links";

const A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const B = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const C = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
const D = "3f2504e0-4f89-41d3-9a0c-0305e82c3304";
const E = "3f2504e0-4f89-41d3-9a0c-0305e82c3305";
const ORIGIN = "https://thesis.fun";

/** Every case states the whole expected id list, so a fold cannot half-land. */
const CASES: { name: string; text: string; origin?: string; ids: string[] }[] = [
	{ name: "1 path-only link", text: `filled it: /p/${A}`, ids: [A] },
	{ name: "2 absolute same-origin link", text: `${ORIGIN}/p/${A}`, origin: ORIGIN, ids: [A] },
	{
		name: "3 absolute link with no origin configured is text",
		text: `${ORIGIN}/p/${A}`,
		ids: [],
	},
	{ name: "4 uppercase uuid normalises to lowercase", text: `/p/${A.toUpperCase()}`, ids: [A] },
	{ name: "5 trailing sentence punctuation", text: `see /p/${A}.`, ids: [A] },
	{ name: "6 wrapped in parentheses", text: `(/p/${A})`, ids: [A] },
	{ name: "7 query string keeps the same position", text: `/p/${A}?ref=feed`, ids: [A] },
	{ name: "8 fragment keeps the same position", text: `/p/${A}#pnl`, ids: [A] },
	{ name: "9 another host is never a trade link", text: `https://evil.example/p/${A}`, origin: ORIGIN, ids: [] },
	{
		name: "10 origin-prefix lookalike host is not same-origin",
		text: `https://thesis.fun.evil.example/p/${A}`,
		origin: ORIGIN,
		ids: [],
	},
	{ name: "11 javascript: URL is never a link", text: `javascript:/p/${A}`, origin: ORIGIN, ids: [] },
	{
		name: "12 nested link in a redirect query is not unwrapped",
		text: `https://evil.example/go?to=${ORIGIN}/p/${A}`,
		origin: ORIGIN,
		ids: [],
	},
	{ name: "13 protocol-relative host is not a link", text: `//evil.example/p/${A}`, origin: ORIGIN, ids: [] },
	{ name: "14 deeper path under /p/ is not a card link", text: `/p/${A}/edit`, ids: [] },
	{ name: "15 malformed uuid is text", text: "/p/3f2504e0-4f89-41d3-9a0c-0305e82c33", ids: [] },
	{ name: "16 duplicate links collapse to one id, in order", text: `/p/${B} /p/${A} /p/${B}`, ids: [B, A] },
	{
		name: "17 more links than the cap keeps the first ones",
		text: [A, B, C, D, E].map((id) => `/p/${id}`).join(" "),
		ids: [A, B, C, D, E].slice(0, MAX_TRADE_CARDS_PER_POST),
	},
	{ name: "18 no links at all", text: "just an opinion, no trade attached", ids: [] },
	{ name: "19 empty text", text: "", ids: [] },
	{
		name: "20 mixed prose, one link, one decoy",
		text: `long BTC /p/${A} not https://x.example/p/${B} done`,
		origin: ORIGIN,
		ids: [A],
	},
];

for (const testCase of CASES) {
	test(`extractTradeLinks: ${testCase.name}`, () => {
		expect(extractTradeLinks(testCase.text, testCase.origin)).toEqual(testCase.ids);
	});
}

describe("renderTextWithLinks", () => {
	test("reproduces the input exactly for every case", () => {
		for (const testCase of CASES) {
			const rebuilt = renderTextWithLinks(testCase.text, testCase.origin)
				.map((token) => (token.kind === "text" ? token.value : token.label))
				.join("");
			expect(rebuilt).toBe(testCase.text);
		}
	});

	test("links every occurrence, including past the card cap", () => {
		const text = [A, B, C, D, E].map((id) => `/p/${id}`).join(" ");
		const links = renderTextWithLinks(text).filter((token) => token.kind === "link");
		expect(links).toHaveLength(5);
		expect(extractTradeLinks(text)).toHaveLength(MAX_TRADE_CARDS_PER_POST);
	});

	test("href is rebuilt, never the matched text", () => {
		const [token] = renderTextWithLinks(`/p/${A.toUpperCase()}?to=https://evil.example`);
		expect(token).toEqual({
			kind: "link",
			label: `/p/${A.toUpperCase()}?to=https://evil.example`,
			href: `/p/${A}`,
			positionId: A,
		});
	});

	test("punctuation around a link stays text", () => {
		expect(renderTextWithLinks(`(/p/${A}).`)).toEqual([
			{ kind: "text", value: "(" },
			{ kind: "link", label: `/p/${A}`, href: `/p/${A}`, positionId: A },
			{ kind: "text", value: ")." },
		]);
	});

	test("whitespace between words is preserved as its own token", () => {
		expect(renderTextWithLinks(`a\n\n/p/${A} b`)).toEqual([
			{ kind: "text", value: "a" },
			{ kind: "text", value: "\n\n" },
			{ kind: "link", label: `/p/${A}`, href: `/p/${A}`, positionId: A },
			{ kind: "text", value: " " },
			{ kind: "text", value: "b" },
		]);
	});

	test("a trailing-slash origin matches the same links", () => {
		expect(extractTradeLinks(`${ORIGIN}/p/${A}`, `${ORIGIN}/`)).toEqual([A]);
	});

	test("origin comparison is case-insensitive on the host", () => {
		expect(extractTradeLinks(`HTTPS://Thesis.Fun/p/${A}`, ORIGIN)).toEqual([A]);
	});
});

test("tradeLinkHref lowercases the id", () => {
	expect(tradeLinkHref(A.toUpperCase())).toBe(`/p/${A}`);
});
