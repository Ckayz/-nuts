"use client";

import { Button } from "@nuts/ui/components/button";
import { TodoOwner } from "@/components/primitives";
import { describeInstrumentKey } from "./instrument-label";

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
	/**
	 * T-2 (Opus user-flow tester). This card used to take `instrument.split("|")[0]`
	 * and print that one field as the whole description, so after a conversation
	 * about a 2540 call, cheaper strikes and a 2600 what-if, the only
	 * confirmation before the server built calldata read `Market ETH` and an
	 * unlabelled `10`. The key carries the right, the strikes, the expiry and the
	 * collateral token; every one of them was discarded.
	 *
	 * Nothing here is derived from the model's words: `describeInstrumentKey`
	 * decodes the SAME key the tool is being approved for, and any field it
	 * cannot read prints nothing at all.
	 */
	const described = describeInstrumentKey(instrument);
	/**
	 * The budget is denominated in the ORDER's collateral token
	 * (`lib/thetanuts/orders.ts:300-306` parses it with that token's decimals),
	 * so the symbol is the key's collateral — never a default currency.
	 */
	const budgetLine = budget === null ? null : described?.collateralSymbol ? `${budget} ${described.collateralSymbol}` : budget;
	const strikes = described === null || described.strikesUsd.length === 0 ? null : described.strikesUsd.join(" / ");
	/**
	 * Which way round the trade goes, as the BOOK records it
	 * (`TradeableOrder.side` is the taker's side). Deliberately Buy/Sell and not
	 * a Bull/Bear word: that vocabulary is decided elsewhere and means the
	 * ASSET's direction, which is not what this field says.
	 */
	const side = described?.side === null || described?.side === undefined ? null : described.side === "buy" ? "Buy" : "Sell";
	const right = described?.right === null || described?.right === undefined ? null : described.right === "call" ? "Call" : "Put";

	return (
		// Design rule (CLAUDE.md): ONE accent, and colour on money only — the amber
		// tint and the mono figures below were neither.
		<div className="rounded-lg border p-4">
			{/* TODO-OWNER: heading. */}
			<p className="font-medium text-sm">
				Prepare this trade? <TodoOwner />
			</p>

			{/* T-2: the same shape the RFQ approval card uses, so the two surfaces
			    tell a reader the same kinds of thing before they approve. */}
			<dl className="mt-3 space-y-1 text-sm">
				<div className="flex justify-between gap-4">
					{/* TODO-OWNER: label. */}
					<dt className="text-muted-foreground">Spend up to</dt>
					<dd className="num">{budgetLine ?? "—"}</dd>
				</div>
				{described?.asset && (
					<div className="flex justify-between gap-4">
						{/* TODO-OWNER: label. */}
						<dt className="text-muted-foreground">Market</dt>
						<dd className="num">{described.asset}</dd>
					</div>
				)}
				{right && (
					<div className="flex justify-between gap-4">
						{/* TODO-OWNER: label. */}
						<dt className="text-muted-foreground">Option</dt>
						<dd className="num">{right}</dd>
					</div>
				)}
				{strikes && (
					<div className="flex justify-between gap-4">
						{/* TODO-OWNER: label. */}
						<dt className="text-muted-foreground">Strikes</dt>
						<dd className="num">{strikes}</dd>
					</div>
				)}
				{described?.expiryAt && (
					<div className="flex justify-between gap-4">
						{/* TODO-OWNER: label. */}
						<dt className="text-muted-foreground">Expiry</dt>
						<dd className="num">{described.expiryAt}</dd>
					</div>
				)}
				{side && (
					<div className="flex justify-between gap-4">
						{/* TODO-OWNER: label, and the vocabulary. */}
						<dt className="text-muted-foreground">Side</dt>
						<dd className="num">{side}</dd>
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
