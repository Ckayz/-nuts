"use client";

import { Button } from "@nuts/ui/components/button";
import { TodoOwner } from "@/components/primitives";
import { strikesAscending } from "./rfq-contract";

/**
 * The approval gate for an RFQ, as the user sees it (PRD 8.6 step 6).
 *
 * The runtime has suspended the agent's write tool and is waiting for an answer.
 * Nothing has been prepared yet: approving here only lets the server BUILD the
 * transaction, and the wallet prompt is a second, separate confirmation.
 *
 * WHAT IT DELIBERATELY DOES NOT PRINT: an escrow figure. The values below are
 * the MODEL'S ARGUMENTS, not a server quote — the deposit is
 * `reservePricePerContract x numContracts` computed the way the factory computes
 * it (W1: `round(perContract x 1e6) x contracts / 1e6`), and re-deriving that in
 * the browser is how a card ends up showing a number the transaction does not
 * carry. `trade-approval.tsx` made the same choice for the same reason ("the
 * cost is not known until the order is re-fetched at prepare time"). The exact
 * escrow, decoded from the calldata, is printed by `rfq-execution.tsx` before
 * anything is signed.
 *
 * Every sentence and label here is this file's own: the mockup draws no agent
 * view and the PRD words no RFQ. Owner rule (CLAUDE.md, "Product numbers and
 * copy are the owner's"), so each carries a `TODO-OWNER` marker in the UI as
 * well as in the source.
 */

interface RfqApprovalInput {
	readonly underlying?: unknown;
	readonly strikesUsd?: unknown;
	readonly expiryAt?: unknown;
	readonly numContracts?: unknown;
	readonly reservePricePerContract?: unknown;
	readonly offerDeadlineMinutes?: unknown;
	readonly rfqRequestId?: unknown;
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

const strikeList = (value: unknown): string | null => {
	if (!Array.isArray(value)) return null;
	const strikes = value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
	if (strikes.length === 0) return null;
	// W1: the factory's order is DESCENDING for a put spread; a reader reads up.
	return strikesAscending(strikes).join(" / ");
};

export function RfqApproval({
	tool,
	input,
	onRespond,
	pending,
}: {
	/** The tool part's own type, e.g. `tool-requestRfqCreation`. */
	readonly tool: string;
	readonly input: RfqApprovalInput | undefined;
	readonly onRespond: (approved: boolean) => void;
	readonly pending: boolean;
}) {
	const create = tool === "tool-requestRfqCreation";
	const cancel = tool === "tool-requestRfqCancellation";

	const underlying = text(input?.underlying);
	const strikes = strikeList(input?.strikesUsd);
	const contracts = text(input?.numContracts);
	const expiry = text(input?.expiryAt);
	const reserve = text(input?.reservePricePerContract);
	const requestId = text(input?.rfqRequestId);

	return (
		<div className="rounded-lg border p-4">
			{/* TODO-OWNER: heading, one per write tool. */}
			<p className="font-medium text-sm">
				{create
					? "Ask market makers for this option?"
					: cancel
						? "Cancel this request and take the escrow back?"
						: "Settle this request?"}{" "}
				<TodoOwner />
			</p>

			<dl className="mt-3 space-y-1 text-sm">
				{underlying && (
					<div className="flex justify-between gap-4">
						{/* TODO-OWNER: label. */}
						<dt className="text-muted-foreground">Market</dt>
						<dd className="num">{underlying}</dd>
					</div>
				)}
				{strikes && (
					<div className="flex justify-between gap-4">
						{/* TODO-OWNER: label. */}
						<dt className="text-muted-foreground">Strikes</dt>
						<dd className="num">{strikes}</dd>
					</div>
				)}
				{contracts && (
					<div className="flex justify-between gap-4">
						{/* TODO-OWNER: label. */}
						<dt className="text-muted-foreground">Contracts</dt>
						<dd className="num">{contracts}</dd>
					</div>
				)}
				{expiry && (
					<div className="flex justify-between gap-4">
						{/* TODO-OWNER: label. */}
						<dt className="text-muted-foreground">Expiry</dt>
						<dd className="num">{expiry}</dd>
					</div>
				)}
				{reserve && (
					<div className="flex justify-between gap-4">
						{/* TODO-OWNER: label. The MOST the user will pay per contract. */}
						<dt className="text-muted-foreground">Most per contract</dt>
						<dd className="num">{reserve} USDC</dd>
					</div>
				)}
				{requestId && (
					<div className="flex justify-between gap-4">
						{/* TODO-OWNER: label. */}
						<dt className="text-muted-foreground">Request</dt>
						<dd className="num">{requestId}</dd>
					</div>
				)}
			</dl>

			<p className="mt-3 text-muted-foreground text-xs leading-relaxed">
				{/* TODO-OWNER: the risk sentence. Every claim in it is true of the code —
				    nothing is sent by this app, the escrow is computed and decoded
				    server-side, and the wallet confirms separately. The WORDING is the
				    owner's. */}
				{create
					? "Approving only builds the transaction. The exact escrow is read out of the calldata and shown to you before you sign, and your wallet will ask you to confirm separately. Nothing is sent until you sign."
					: "Approving only builds the transaction. Your wallet will ask you to confirm it separately, and nothing is sent until you sign."}{" "}
				<TodoOwner />
			</p>

			<div className="mt-4 flex gap-2">
				{/* TODO-OWNER: button labels. */}
				<Button size="sm" onClick={() => onRespond(true)} disabled={pending}>
					{pending ? "Preparing…" : "Approve"}
				</Button>
				<Button size="sm" variant="outline" onClick={() => onRespond(false)} disabled={pending}>
					Cancel
				</Button>
			</div>
		</div>
	);
}

/** The write tools this card answers for. Anything else keeps the trade card. */
export const RFQ_APPROVAL_TOOLS: ReadonlySet<string> = new Set([
	"tool-requestRfqCreation",
	"tool-requestRfqCancellation",
	"tool-requestRfqSettlement",
]);
