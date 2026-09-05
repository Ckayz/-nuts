"use client";

import { Button } from "@nuts/ui/components/button";

/**
 * The approval gate, as the user sees it (PRD 8.6 step 6).
 *
 * The runtime has suspended the agent's tool call and is waiting for an answer.
 * Nothing has been prepared yet: approving here only lets the server BUILD the
 * transaction. The wallet prompt is a second, separate confirmation.
 *
 * The card shows what the agent asked for, not what it will cost, because the
 * cost is not known until the order is re-fetched at prepare time. Promising a
 * figure here that the fresh quote then contradicts would be worse than showing
 * none.
 */

interface ApprovalInput {
	readonly instrumentKey?: unknown;
	readonly budget?: unknown;
}

export function TradeApproval({
	input,
	onRespond,
	pending,
}: {
	input: ApprovalInput | undefined;
	onRespond: (approved: boolean) => void;
	pending: boolean;
}) {
	const budget = typeof input?.budget === "string" ? input.budget : null;
	const instrument = typeof input?.instrumentKey === "string" ? input.instrumentKey : null;
	const asset = instrument?.split("|")[0] ?? null;

	return (
		<div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
			<p className="font-medium text-sm">Prepare this trade?</p>

			<dl className="mt-3 space-y-1 text-sm">
				<div className="flex justify-between gap-4">
					<dt className="text-muted-foreground">Spend up to</dt>
					<dd className="font-mono">{budget ?? "—"}</dd>
				</div>
				{asset && (
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Market</dt>
						<dd className="font-mono">{asset}</dd>
					</div>
				)}
			</dl>

			<p className="mt-3 text-muted-foreground text-xs leading-relaxed">
				Approving only builds the transaction. The price is re-checked against the live
				order book first, and your wallet will ask you to confirm separately. Nothing is
				sent until you sign.
			</p>

			<div className="mt-4 flex gap-2">
				<Button size="sm" onClick={() => onRespond(true)} disabled={pending}>
					{pending ? "Preparing…" : "Approve"}
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() => onRespond(false)}
					disabled={pending}
				>
					Cancel
				</Button>
			</div>
		</div>
	);
}
