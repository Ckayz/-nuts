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
 * own — the mockup draws no agent view — so all four are TODO-OWNER. Each names
 * a real tool in `lib/agent/tools.ts`; reword them, but do not make one claim
 * something the tool does not do.
 */
const LABELS: Record<string, string> = {
	"tool-searchOptionBookOrders": "Searching live liquidity",
	"tool-getMarketData": "Checking market prices",
	"tool-previewOptionBookTrade": "Pricing the trade",
	"tool-getThesisContext": "Looking up the thesis",
};

interface ToolPart {
	type: string;
	state?: string;
	output?: unknown;
}

export function ToolActivity({ part }: { part: ToolPart }) {
	const label = LABELS[part.type] ?? part.type.replace(/^tool-/, "");
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
