"use client";

/**
 * What pops up the moment a fill confirms: the position's card, a link to copy,
 * and a way to write a post about it.
 *
 * Shape from the owner's fomo reference (`.demo/fomo-share-card.png`,
 * 2026-09-05): owner name, status chip, instrument, one big signed P&L with a
 * percentage, three stat tiles. No price line — the owner removed charts.
 *
 * HANDOVER: the card itself is being built as
 * `src/components/position/pnl-card.tsx` by the position-page writer. This is
 * the minimal stand-in, and its props are a plain View type (`FillCard`) so the
 * orchestrator can swap the component at merge without touching this dialog.
 *
 * `packages/ui/src/components` has no dialog (checked 2026-09-05: attachment,
 * bubble, button, card, checkbox, dropdown-menu, empty, input-group, input,
 * label, marker, message-scroller, message, skeleton, sonner, textarea,
 * tooltip), so this is a plain accessible one: `role="dialog"`, `aria-modal`,
 * labelled by its heading, focus moved in on open, Escape and backdrop close,
 * focus cycled inside, and focus returned to the opener.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TodoOwner } from "@/components/primitives";
import type { FillCard } from "@/lib/trade/types";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function FillDialog({
	card,
	txHref,
	txLabel,
	onClose,
}: {
	card: FillCard;
	txHref: string;
	txLabel: string;
	onClose: () => void;
}) {
	const panel = useRef<HTMLDivElement>(null);
	const opener = useRef<Element | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		opener.current = document.activeElement;
		panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
		const restore = opener.current;
		return () => {
			if (restore instanceof HTMLElement) restore.focus();
		};
	}, []);

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
				return;
			}
			if (event.key !== "Tab") return;
			const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
			const first = items[0];
			const last = items[items.length - 1];
			if (first === undefined || last === undefined) return;
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		},
		[onClose],
	);

	const copy = useCallback(() => {
		const url = new URL(card.positionPath, window.location.origin).toString();
		navigator.clipboard
			.writeText(url)
			.then(() => setCopied(true))
			.catch(() => setCopied(false));
	}, [card.positionPath]);

	return (
		// Inline styles, not new CSS: `src/index.css` is outside this round's
		// fence. The backdrop click is a convenience; Escape and the Close button
		// are the keyboard paths, and both are wired above.
		<div
			style={{
				position: "fixed",
				inset: 0,
				background: "rgba(0,0,0,.66)",
				display: "grid",
				placeItems: "center",
				padding: "24px",
				zIndex: 50,
			}}
			onKeyDown={onKeyDown}
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				className="panel"
				style={{ maxWidth: "420px", width: "100%", maxHeight: "90vh", overflowY: "auto" }}
				role="dialog"
				aria-modal="true"
				aria-labelledby="fill-dialog-title"
				ref={panel}
			>
				<div className="who2">
					<b id="fill-dialog-title">{card.ownerLabel}</b>
					<span className="live">{card.statusLabel}</span>
				</div>
				<span className="note">
					{card.instrumentLabel} · {card.sideLabel}
				</span>
				<div className="board">
					<div>
						<span className="lbl">Live P&amp;L</span>
						<span className={`v ${card.pnlClass}`}>
							{card.pnlLabel} {card.pnlPercentLabel === "—" ? null : `(${card.pnlPercentLabel})`}
						</span>
					</div>
				</div>
				<span className="note">
					Live P&amp;L needs a mark for this option. Nothing published one at the moment this fill confirmed,
					so no number is shown rather than a guess. Mark source <TodoOwner />
				</span>
				<dl className="kv">
					{card.tiles.map((tile) => (
						<Fragment key={tile.label}>
							<dt>{tile.label}</dt>
							<dd className="mono">{tile.value}</dd>
						</Fragment>
					))}
				</dl>
				<a className="tx" href={txHref} rel="noreferrer" target="_blank">
					{txLabel}
				</a>
				<button type="button" className="btn primary block" onClick={copy}>
					{copied ? "Link copied" : "Copy link"}
				</button>
				<Link className="btn block" href={{ pathname: "/new", query: { link: card.positionPath } }}>
					Write a post about it
				</Link>
				<button type="button" className="btn block" onClick={onClose}>
					Close
				</button>
				<span className="note">
					Dialog copy and the share-card layout <TodoOwner />
				</span>
			</div>
		</div>
	);
}
