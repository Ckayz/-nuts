"use client";

/**
 * K-2 (pass-4 D4-M2). The page's columns are RENDERED in the order the viewer
 * reads them, so the tab sequence follows the page.
 *
 * `index.css` moves the left rail with `order` when the columns stack, and
 * `styles/market.css` used to move the market TICKET the same way, with
 * `display:contents` on `.col-main` and `.col-right`. `order` is a visual
 * property: the DOM — and therefore the tab sequence and what a screen reader
 * reads — kept the original order. MEASURED on /m/eth at 1000px before this:
 *
 *   … Agent@60 | Markets@8048 | AVAX@8083 | … | XRP@8367 | <chart marker>@1415 …
 *
 * eight stops ~8,000px down into the left rail and 6,965px back; and after the
 * rail was fixed, the ticket — the money-path input, visually second — was
 * still reached only after every one of the 131 focusables in the main column,
 * a 6,868px jump. WCAG 2.4.3 Focus Order (A) and 1.3.2 Meaningful Sequence.
 *
 * The DOM order per band, which is what `index.css` and `styles/market.css`
 * now describe rather than override:
 *
 *   wide    (>=1181px)      left · main(lead+body) · ticket · right
 *   stacked (901-1180px)    mainLead · ticket · main · right · left
 *   phone   (<=900px) feed  mainLead · ticket · main · left · right   (owner decision 7)
 *   phone   (<=900px) other mainLead · ticket · main · right · left
 *
 * At the wide band the three columns are the mockup's three columns, so the
 * market header goes back inside `.col-main` and the ticket takes the top of
 * column 3 by grid placement (`styles/market.css`). Stacked, every slot is its
 * own row in the one column and the DOM order IS the visual order, so no
 * `order` rule is needed for anything but the left rail.
 *
 * WHAT MUST NOT REMOUNT. `.col-ticket` and `.col-right` are the SAME wrapper
 * elements with the same keys in every band, so React MOVES those subtrees
 * instead of re-creating them: the ticket keeps its typed budget, its held fill
 * and its approval flow across a resize, and the Agent tab keeps its chat
 * (`right-tabs.tsx` mounts all three panels and hides two — unmounting the
 * agent would throw the conversation away). The market header is the one slot
 * that changes parent between bands; it is a static server-rendered card with
 * no state, so re-rendering it costs nothing.
 *
 * The server renders the WIDE order and `getServerSnapshot` returns it during
 * hydration, so the first client render is byte-identical to the server's; a
 * narrow viewport re-orders in the effect that follows.
 */
import { Fragment, useSyncExternalStore, type ReactNode } from "react";

/** The two breakpoints are `index.css`'s; they are not chosen here. */
const STACKED = "(max-width: 1180px)";
const PHONE = "(max-width: 900px)";

type Band = "wide" | "stacked" | "phone";
export type ColumnSlot = "left" | "mainLead" | "main" | "ticket" | "right";

function subscribe(onChange: () => void): () => void {
	const stacked = window.matchMedia(STACKED);
	const phone = window.matchMedia(PHONE);
	stacked.addEventListener("change", onChange);
	phone.addEventListener("change", onChange);
	return () => {
		stacked.removeEventListener("change", onChange);
		phone.removeEventListener("change", onChange);
	};
}

function readBand(): Band {
	if (window.matchMedia(PHONE).matches) return "phone";
	return window.matchMedia(STACKED).matches ? "stacked" : "wide";
}

function serverBand(): Band {
	return "wide";
}

/**
 * Pure, so the table above can be asserted without a browser.
 *
 * `mainLead` is absent from the wide order on purpose: there it renders INSIDE
 * `.col-main`, above the rest of the centre column, exactly where the mockup
 * puts the market header.
 */
export function columnOrder(band: Band, phoneLeftFirst: boolean): ColumnSlot[] {
	if (band === "wide") return ["left", "main", "ticket", "right"];
	if (band === "phone" && phoneLeftFirst) return ["mainLead", "ticket", "main", "left", "right"];
	return ["mainLead", "ticket", "main", "right", "left"];
}

export function StackedColumns({
	left,
	mainLead,
	main,
	ticket,
	right,
	stackGap,
	phoneLeftFirst,
}: {
	left: ReactNode;
	/** The market header: rendered inside `.col-main` when wide, its own row when stacked. */
	mainLead: ReactNode;
	main: ReactNode;
	/** The market ticket. Its wrapper is the same element in every band. */
	ticket: ReactNode;
	right: ReactNode;
	stackGap: "lg" | "sm";
	/** True on the feed, whose left column stays in the flow at <=900px. */
	phoneLeftFirst: boolean;
}) {
	const band = useSyncExternalStore(subscribe, readBand, serverBand);
	const nested = band === "wide";
	const node: Record<ColumnSlot, ReactNode> = {
		left:
			left === undefined ? null : (
				<div className="col-left">
					<div className="sticky">{left}</div>
				</div>
			),
		mainLead: nested || mainLead === undefined ? null : <div className="col-mainlead">{mainLead}</div>,
		main: (
			<div className={stackGap === "lg" ? "col-main stack lg" : "col-main stack"}>
				{/* Keyed so the body below keeps its identity whichever band the
				    header is rendered in: without the key React would reconcile
				    `.col-main`'s children by index and remount the whole centre
				    column — the chart included — on every crossing of 1180px. */}
				<Fragment key="lead">{nested ? mainLead : null}</Fragment>
				<Fragment key="body">{main}</Fragment>
			</div>
		),
		ticket: ticket === undefined ? null : <div className="col-ticket stack">{ticket}</div>,
		right:
			right === undefined ? null : (
				<div className="col-right">
					<div className="sticky stack">{right}</div>
				</div>
			),
	};
	return (
		<>
			{columnOrder(band, phoneLeftFirst).map((key) => (
				<Fragment key={key}>{node[key]}</Fragment>
			))}
		</>
	);
}
