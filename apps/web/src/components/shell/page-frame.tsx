import type { ReactNode } from "react";

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
 */
export function PageFrame({
	variant = "page",
	left,
	right,
	stackGap = "lg",
	ticketFirst = false,
	children,
}: {
	variant?: "feed" | "page";
	left?: ReactNode;
	right?: ReactNode;
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
			{left === undefined ? null : (
				<div className="col-left">
					<div className="sticky">{left}</div>
				</div>
			)}
			<div className={stackGap === "lg" ? "col-main stack lg" : "col-main stack"}>{children}</div>
			{right === undefined ? null : (
				<div className="col-right">
					<div className="sticky stack">{right}</div>
				</div>
			)}
		</div>
	);
}
