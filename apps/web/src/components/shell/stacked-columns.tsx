"use client";

/**
 * K-2 (pass-4 D4-M2). The three columns are RENDERED in the order the viewer
 * reads them, so the tab sequence follows the page.
 *
 * `index.css` moves the left rail with `order` when the columns stack, but
 * `order` is a visual property: the DOM — and therefore the tab sequence — kept
 * the rail FIRST. MEASURED on /m/eth at this commit, before this component, the
 * document Y of each Tab stop at 1000px and 1180px:
 *
 *   … Agent@60 | Markets@8048 | AVAX@8083 | … | XRP@8367 | <chart marker>@1415 …
 *
 * Eight stops ~8,000px down the page into the rail, then back up 6,965px.
 * WCAG 2.4.3 Focus Order (A) and 1.3.2 Meaningful Sequence.
 *
 * The order per band, which is the same table `index.css` encodes with `order`:
 *
 *   wide      (>=1181px)         left · main · right   (no `order` rule applies)
 *   stacked   (901-1180px)       main · right · left   (`.col-left{order:9}`)
 *   phone     (<=900px) feed     main · left · right   (`.cols.feed>.col-left{order:1}`,
 *                                                       `.cols.feed>.col-right{order:2}`;
 *                                                       owner decision 7)
 *   phone     (<=900px) other    main · right · left   (`.col-left{display:none}`)
 *
 * The server renders the WIDE order and `getServerSnapshot` returns it during
 * hydration, so the first client render is byte-identical to the server's; a
 * narrow viewport re-orders in the effect that follows. The `order` rules stay
 * in `index.css` and are kept identical to the table above, so the first paint
 * — before this component's JavaScript runs, and with JavaScript off — is still
 * laid out correctly.
 *
 * Keys make React MOVE the three subtrees rather than remount them, which is
 * what keeps the market ticket's own state across a viewport change.
 */
import { Fragment, useSyncExternalStore, type ReactNode } from "react";

/** The two breakpoints are `index.css`'s; they are not chosen here. */
const STACKED = "(max-width: 1180px)";
const PHONE = "(max-width: 900px)";

type Band = "wide" | "stacked" | "phone";

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

/** Pure, so the table above can be asserted without a browser. */
export function columnOrder(band: Band, phoneLeftFirst: boolean): Array<"left" | "main" | "right"> {
	if (band === "wide") return ["left", "main", "right"];
	if (band === "phone" && phoneLeftFirst) return ["main", "left", "right"];
	return ["main", "right", "left"];
}

export function StackedColumns({
	left,
	main,
	right,
	phoneLeftFirst,
}: {
	left: ReactNode;
	main: ReactNode;
	right: ReactNode;
	/** True on the feed, whose left column stays in the flow at <=900px. */
	phoneLeftFirst: boolean;
}) {
	const band = useSyncExternalStore(subscribe, readBand, serverBand);
	const slots: Record<"left" | "main" | "right", ReactNode> = { left, main, right };
	return (
		<>
			{columnOrder(band, phoneLeftFirst).map((key) => (
				<Fragment key={key}>{slots[key]}</Fragment>
			))}
		</>
	);
}
