/**
 * D-10 (lane D): the guide is only useful if the names in it are the names on
 * screen.
 *
 * Measured at pin `f414824`, five sentences in
 * `docs/HOW-TO-TRADE-WITH-THE-AGENT.md` were not true of the code: it named a
 * branch, told the reader to press **Prepare** and **Cancel** and **Settle**
 * (the controls read "Sign in wallet", "Cancel the request" and "Settle it"),
 * quoted a chip as "Ask for a custom option (RFQ)" when it renders "Ask for a
 * custom ETH option", and promised a cancel "at any time".
 *
 * A doc rots the moment a label changes, so the guide states its own
 * convention — every **bold** name is a control, written as the app renders it
 * — and this file enforces it against the SOURCE of those labels. A phrase
 * that is bold but is not a control is listed by name below, so adding one is
 * a decision rather than an accident.
 */
import { expect, test } from "bun:test";

const root = new URL("../../../../../", import.meta.url);
const GUIDE = new URL("docs/HOW-TO-TRADE-WITH-THE-AGENT.md", root);

/** Every file that declares a string the agent surface can render. */
const LABEL_SOURCES = [
	"apps/web/src/components/agent/rfq-execution.tsx",
	"apps/web/src/components/agent/rfq-approval.tsx",
	"apps/web/src/components/agent/trade-execution.tsx",
	"apps/web/src/components/agent/trade-approval.tsx",
	"apps/web/src/components/agent/agent-chat.tsx",
	"apps/web/src/components/agent/agent-launcher.tsx",
	"apps/web/src/lib/agent/suggestions.ts",
];

/**
 * Bold phrases in the guide that are NOT controls.
 *
 * Kept short on purpose: the convention is that bold means "a thing you press",
 * so every exception is a small piece of debt and is visible here.
 */
const NOT_A_CONTROL: ReadonlySet<string> = new Set([
	// The chain, not a button.
	"Base mainnet",
	// The convention sentence at the top of the guide describes itself.
	"bold",
]);

/**
 * A chip whose label is built from the market it is on
 * (`suggestions.ts` `startRfqLabel`), so the guide names two real examples.
 */
const TEMPLATED: ReadonlySet<string> = new Set(["Ask for a custom ETH option", "Ask for a custom BTC option"]);

async function read(path: string): Promise<string> {
	return await Bun.file(new URL(path, root)).text();
}

test("D-10: every control the guide names is a string the app renders", async () => {
	const guide = await Bun.file(GUIDE).text();
	const sources = (await Promise.all(LABEL_SOURCES.map(read))).join("\n");
	const bold = [...guide.matchAll(/\*\*(.+?)\*\*/g)].map((match) => match[1] ?? "");
	const controls = bold.filter((phrase) => !NOT_A_CONTROL.has(phrase));
	console.log("GUIDE_CONTROLS", JSON.stringify([...new Set(controls)]));

	const missing = controls.filter((phrase) => {
		if (TEMPLATED.has(phrase)) {
			// `Ask for a custom ${asset} option` — the two halves must both be there.
			return !(sources.includes("Ask for a custom ") && sources.includes(" option`"));
		}
		return !sources.includes(phrase);
	});
	console.log("GUIDE_MISSING", JSON.stringify(missing));
	expect(missing).toEqual([]);
});

test("D-10: the five statements the reviewer measured as untrue are gone", async () => {
	const guide = await Bun.file(GUIDE).text();
	// The branch name: `git branch --contains f414824` answered `main`.
	expect(guide).not.toContain("rfq-int");
	// Controls that do not exist under those names.
	expect(guide).not.toMatch(/press \*\*Prepare\*\*/i);
	expect(guide).not.toMatch(/press \*\*Cancel\*\*/i);
	expect(guide).not.toMatch(/press \*\*Settle\*\*/i);
	// The promise D-1 made false: a cancel was offered "at any time" while the
	// control did not render at all on `expired_unfilled`.
	expect(guide).not.toMatch(/Cancel[^.\n]{0,60}at any time/i);
});

test("D-10: the guide names the statuses a cancel is actually offered on", async () => {
	const guide = await Bun.file(GUIDE).text();
	const status = await read("apps/web/src/lib/rfq/status.ts");
	// The server's own vocabulary: an expired, unfilled request is the state the
	// guide has to name, because it is the one where the escrow is stranded and
	// cancelling is the way back (D-1).
	expect(status).toContain("expired_unfilled");
	expect(guide).toContain("expired unfilled");
	expect(guide).toContain("Cancel the request");
	console.log(
		"GUIDE_CANCEL_LINE",
		JSON.stringify(guide.split("\n").find((line) => line.includes("Cancel the request")) ?? ""),
	);
});
