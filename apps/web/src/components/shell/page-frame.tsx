import type { ReactNode } from "react";
import { StackedColumns } from "./stacked-columns";

/**
 * The three-column frame every page sits in
 * (docs/mockups/thesis-fun-mockup.html, `.cols.feed` / `.cols.page`).
 *
 *   feed  292px · centre · 332px   — only the feed uses these widths
 *   page  264px · centre · 344px   — every other page
 *
 * A rail that is `undefined` drops its grid track (`.no-left` / `.no-right`),
 * so a page with one rail is not left with an empty column. Both rails are
 * sticky under the top bar and nav, as the mockup has them.
 *
 * K-2: the wrappers are built by `StackedColumns`, which renders them in the
 * order the viewer reads them at the current width. The classes, the dropped
 * tracks and the sticky rails are exactly as they were; only the ORDER moves,
 * and `.col-ticket` / `.col-right` keep their identity across a band change so
 * the ticket and the agent chat never remount.
 */
export function PageFrame({
	variant = "page",
	left,
	mainLead,
	right,
	ticket,
	stackGap = "lg",
	ticketFirst = false,
	children,
}: {
	variant?: "feed" | "page";
	left?: ReactNode;
	/**
	 * The lead card of the centre column — the market header. Rendered inside
	 * `.col-main` at >=1181px and as its own row above the ticket when the
	 * columns stack, which is what lets the ticket sit between it and the rest
	 * of the centre column in the DOM as well as on screen.
	 */
	mainLead?: ReactNode;
	right?: ReactNode;
	/** Market only: the ticket, which stacks directly under `mainLead`. */
	ticket?: ReactNode;
	/** Centre column gap: `lg` is 18px, `sm` 14px. The feed uses `sm`. */
	stackGap?: "lg" | "sm";
	/** Market only: place its ticket after the header when the rails stack. */
	ticketFirst?: boolean;
	children: ReactNode;
}) {
	const columns = [
		"cols",
		variant,
		ticketFirst ? "ticket-first" : "",
		left === undefined ? "no-left" : "",
		right === undefined ? "no-right" : "",
	]
		.filter(Boolean)
		.join(" ");
	return (
		<div className={columns}>
			<StackedColumns
				phoneLeftFirst={variant === "feed"}
				stackGap={stackGap}
				left={left}
				mainLead={mainLead}
				main={children}
				ticket={ticket}
				right={right}
			/>
		</div>
	);
}
