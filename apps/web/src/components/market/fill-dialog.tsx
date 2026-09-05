"use client";

/**
 * What pops up the moment a fill confirms: the share card, a link to copy, and a
 * way to write a post about it.
 *
 * Layout from the mockup's post-trade dialog (lines 1037-1049 and the shot
 * `.research/thetanuts/design-r1-shots/design-r1-4-dialog.png`): a dimmed
 * backdrop, a 520px panel with a title row and a close ×, the accent-framed
 * share card as the whole body, then "Copy link" and "Write a post about it"
 * side by side.
 *
 * The body is the SAME `PnlCard` share card `/p/[id]` renders (round-1 fold
 * item 16): `lib/trade/record.ts` now builds a `View.PnlCard` through the one
 * builder in `lib/position/view.ts`, so the dialog gained the avatar, the date
 * and the shared status vocabulary instead of a hand-copied lookalike.
 *
 * `packages/ui/src/components` has no dialog (checked 2026-09-05: attachment,
 * bubble, button, card, checkbox, dropdown-menu, empty, input-group, input,
 * label, marker, message-scroller, message, skeleton, sonner, textarea,
 * tooltip), so this is a plain accessible one: `role="dialog"`, `aria-modal`,
 * labelled by its heading, focus moved in on open, Escape and backdrop close,
 * focus cycled inside, and focus returned to the opener. None of that changed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PnlCard } from "@/components/position/pnl-card";
import { TodoOwner } from "@/components/primitives";
import type { FillCard } from "@/lib/trade/types";
import "@/styles/position.css";

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
		// The backdrop click is a convenience; Escape and the close button are the
		// keyboard paths, and both are wired above.
		<div
			className="scrim"
			onKeyDown={onKeyDown}
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className="dlg" role="dialog" aria-modal="true" aria-labelledby="fill-dialog-title" ref={panel}>
				<div className="dlg-h">
					<h3 id="fill-dialog-title">
						Filled · your position is live
						<TodoOwner />
					</h3>
					<button type="button" className="dlg-x" onClick={onClose} aria-label="Close">
						×
					</button>
				</div>

				<PnlCard card={card} />

				<a className="sc-tx num dlg-tx" href={txHref} rel="noreferrer noopener" target="_blank">
					{txLabel}
				</a>

				<div className="dlg-acts">
					<button type="button" className="btn sec" onClick={copy}>
						{copied ? "Link copied" : "Copy link"}
					</button>
					<Link className="btn acc" href={{ pathname: "/new", query: { link: card.positionPath } }}>
						Write a post about it
					</Link>
				</div>
				<span className="dlg-note">
					Dialog copy and the share-card layout
					<TodoOwner />
				</span>
			</div>
		</div>
	);
}
