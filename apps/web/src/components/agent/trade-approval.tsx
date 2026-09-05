"use client";

import { Button } from "@nuts/ui/components/button";
import { TodoOwner } from "@/components/primitives";

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
 *
 * D-C2 (lane D confirming pass). Every sentence and label below is this file's
 * own: the mockup draws no agent view and the PRD sets no wording for it. Owner
 * rule (CLAUDE.md, "Product numbers and copy are the owner's"), so each one
 * carries a `TODO-OWNER` marker in the UI as well as in the source.
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
		// Design rule (CLAUDE.md): ONE accent, and colour on money only — the amber
		// tint and the mono figures below were neither.
		<div className="rounded-lg border p-4">
			{/* TODO-OWNER: heading. */}
			<p className="font-medium text-sm">
				Prepare this trade? <TodoOwner />
			</p>

			<dl className="mt-3 space-y-1 text-sm">
				<div className="flex justify-between gap-4">
					{/* TODO-OWNER: label. */}
					<dt className="text-muted-foreground">Spend up to</dt>
					<dd className="num">{budget ?? "—"}</dd>
				</div>
				{asset && (
					<div className="flex justify-between gap-4">
						{/* TODO-OWNER: label. */}
						<dt className="text-muted-foreground">Market</dt>
						<dd className="num">{asset}</dd>
					</div>
				)}
			</dl>

			<p className="mt-3 text-muted-foreground text-xs leading-relaxed">
				{/* TODO-OWNER: the risk sentence. Every claim in it is true of the code
				    (nothing is sent by this app, the order is re-fetched, the wallet
				    confirms separately) — the WORDING is the owner's. */}
				Approving only builds the transaction. The price is re-checked against the live
				order book first, and your wallet will ask you to confirm separately. Nothing is
				sent until you sign. <TodoOwner />
			</p>

			<div className="mt-4 flex gap-2">
				{/* TODO-OWNER: button labels. */}
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
