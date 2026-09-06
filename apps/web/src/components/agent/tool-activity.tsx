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
	/** `ai@7.0.92` dist/index.d.ts:2065-2078: the answer a person gave the card. */
	approval?: { approved?: boolean };
}

/**
 * TODO-OWNER: T-1 — what a step the user cancelled is called.
 *
 * Appended to the tool's own sentence the way `— failed` is, so the three
 * terminal readings share one shape.
 */
const CANCELLED_SUFFIX = "cancelled";

export function ToolActivity({ part }: { part: ToolPart }) {
	const label = TOOL_ACTIVITY_LABELS[part.type] ?? part.type.replace(/^tool-/, "");
	const done = part.state === "output-available";
	const failed = part.state === "output-error";
	/**
	 * T-1. A call the user declined is TERMINAL, and used to render exactly like
	 * one still in flight: the runtime moves a declined tool call to
	 * `output-denied` (dist/index.d.ts:2114), and leaves the part at
	 * `approval-responded` with `approved: false` until it does. Neither state
	 * was known here, so the reader was told `Preparing the trade…` under a reply
	 * that had already moved on — for ever.
	 */
	const cancelled = part.state === "output-denied" || (part.state === "approval-responded" && part.approval?.approved === false);

	const asOf =
		done && part.output && typeof part.output === "object" && "asOf" in part.output
			? String((part.output as { asOf: unknown }).asOf)
			: null;

	return (
		<p className="flex items-center gap-2 text-muted-foreground text-xs">
			<span aria-hidden>{cancelled ? "✕" : failed ? "✗" : done ? "✓" : "○"}</span>
			<span>
				{cancelled
					? `${label} — ${CANCELLED_SUFFIX}`
					: failed
						? `${label} — failed`
						: done
							? label
							: `${label}…`}
			</span>
			{asOf && (
				<time dateTime={asOf} className="opacity-70">
					{new Date(asOf).toLocaleTimeString()}
				</time>
			)}
		</p>
	);
}
