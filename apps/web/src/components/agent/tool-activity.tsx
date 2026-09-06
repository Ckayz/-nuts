"use client";

/**
 * Shows what the agent actually looked at.
 *
 * This is a trust surface, not decoration: the product's claim is that every
 * number comes from live data (PRD 6), and a user can only believe that if they
 * can see the lookups happening.
 */

/**
 * D-C2. What each lookup is CALLED while it runs. Every phrase is this file's
 * own — the mockup draws no agent view — so all of them are TODO-OWNER. Each
 * names a real tool in `lib/agent/tools.ts`, `positions.ts`, `execute.ts` or
 * `rfq-tools.ts`; reword them, but do not make one claim something the tool
 * does not do.
 *
 * W4 follow-up 2 (`.research/rfq/followups.md`), measured in the browser walk:
 * only the first four tools had a label, so the position, what-if and all seven
 * RFQ tools printed their RAW CAMELCASE NAME — "buildCustomRfqPreview" — in the
 * middle of a reply. The map now covers every entry in `AGENT_TOOL_NAMES`, and
 * `tool-activity.test.ts` fails if a tool is added without one.
 *
 * TODO-OWNER: all fourteen sentences.
 */
export const TOOL_ACTIVITY_LABELS: Record<string, string> = {
	"tool-searchOptionBookOrders": "Searching live liquidity",
	"tool-getMarketData": "Checking market prices",
	"tool-previewOptionBookTrade": "Pricing the trade",
	"tool-getThesisContext": "Looking up the thesis",
	"tool-getUserPositions": "Reading your positions",
	"tool-whatIfAtExpiry": "Working out the payoff at that price",
	"tool-requestOptionBookExecution": "Preparing the trade",
	"tool-buildCustomRfqPreview": "Previewing the custom request",
	"tool-suggestRfqReservePrice": "Reading maker prices",
	"tool-getRfqStatus": "Checking your request",
	"tool-listMyRfqs": "Listing your requests",
	"tool-requestRfqCreation": "Preparing the request",
	"tool-requestRfqCancellation": "Preparing the cancel",
	"tool-requestRfqSettlement": "Preparing the settlement",
};

interface ToolPart {
	type: string;
	state?: string;
	output?: unknown;
}

export function ToolActivity({ part }: { part: ToolPart }) {
	const label = TOOL_ACTIVITY_LABELS[part.type] ?? part.type.replace(/^tool-/, "");
	const done = part.state === "output-available";
	const failed = part.state === "output-error";

	const asOf =
		done && part.output && typeof part.output === "object" && "asOf" in part.output
			? String((part.output as { asOf: unknown }).asOf)
			: null;

	return (
		<p className="flex items-center gap-2 text-muted-foreground text-xs">
			<span aria-hidden>{failed ? "✗" : done ? "✓" : "○"}</span>
			<span>{failed ? `${label} — failed` : done ? label : `${label}…`}</span>
			{asOf && (
				<time dateTime={asOf} className="opacity-70">
					{new Date(asOf).toLocaleTimeString()}
				</time>
			)}
		</p>
	);
}
