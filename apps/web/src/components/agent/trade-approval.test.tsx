/**
 * T-2 (Opus user-flow tester): what the OptionBook approval card tells a person
 * before they let the server build a transaction.
 *
 * Measured in a browser at pin `f414824`, after a conversation that had
 * discussed a 2540 call AND cheaper strikes AND a 2600 what-if:
 *
 *   Prepare this trade?
 *   Spend up to   10
 *   Market        ETH
 *
 * `10` carries no currency, and `ETH` is the whole instrument description —
 * while the key the card is holding names the right, the strikes, the expiry
 * and the collateral token. The RFQ card in the same product prints all of it.
 *
 * `renderToStaticMarkup`, like `agent-heading.test.tsx`: this component holds no
 * state, so the markup IS the surface.
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TradeApproval } from "./trade-approval";

/** A real key, in the grammar `lib/thetanuts/instrument.ts:14-24` builds. */
const ETH_CALL =
	"ETH|buy|0x833589fcd6edb6e08f4c7c32d4f71b54bda02913|C|254000000000|1757232000|0x6ad53dd058bea004829ccf58a282c21a7df02dca";
const ETH_PUT_SPREAD =
	"ETH|sell|0x4e65fe4dba92790696d040ac24aa414708f5c0ab|P|245000000000/250000000000|1757232000|0x6ad53dd058bea004829ccf58a282c21a7df02dca";

/** Every string the card renders, tags stripped — what a reader sees. */
function text(html: string): string {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/&#x27;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

const card = (input: Record<string, unknown> | undefined) =>
	text(renderToStaticMarkup(<TradeApproval input={input} onRespond={() => {}} pending={false} />));

test("T-2: the budget carries its currency", () => {
	const shown = card({ instrumentKey: ETH_CALL, budget: "10" });
	console.log("BUDGET", shown);
	// The collateral token of THIS order, decoded from the key — never a
	// default currency and never a bare number.
	expect(shown).toContain("Spend up to 10 USDC");
	expect(shown).not.toMatch(/Spend up to 10 (?!USDC)/);
});

test("T-2: the card names the instrument the agent asked to prepare", () => {
	const shown = card({ instrumentKey: ETH_CALL, budget: "10" });
	console.log("INSTRUMENT", shown);
	expect(shown).toContain("ETH");
	expect(shown).toContain("Call");
	expect(shown).toContain("2540");
	// The expiry as a person reads it, in UTC, not a unix integer.
	expect(shown).toContain("07 Sep 2025, 08:00 UTC");
	expect(shown).not.toContain("1757232000");
	// And which way round it is.
	expect(shown).toContain("Buy");
});

test("T-2: a spread prints both strikes, in the collateral it is quoted in", () => {
	const shown = card({ instrumentKey: ETH_PUT_SPREAD, budget: "2.5" });
	console.log("SPREAD", shown);
	expect(shown).toContain("2450 / 2500");
	expect(shown).toContain("Put");
	expect(shown).toContain("Sell");
	expect(shown).toContain("Spend up to 2.5 aBasUSDC");
});

test("a key the app cannot read adds nothing rather than inventing it", () => {
	// The old behaviour for an unreadable key was to print its first `|` field as
	// the market. Nothing is invented now: no strike, no expiry, no currency.
	const shown = card({ instrumentKey: "not-one-of-ours", budget: "10" });
	console.log("UNREADABLE", shown);
	expect(shown).toContain("Prepare this trade?");
	expect(shown).toContain("Spend up to 10");
	expect(shown).not.toContain("USDC");
	expect(shown).not.toContain("not-one-of-ours");
});

test("no input at all still renders a card that asks the question", () => {
	const shown = card(undefined);
	console.log("EMPTY", shown);
	expect(shown).toContain("Prepare this trade?");
	expect(shown).toContain("Approve");
	expect(shown).toContain("Cancel");
});
