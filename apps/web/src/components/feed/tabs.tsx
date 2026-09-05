"use client";

/**
 * The two tab presentations the mockup uses, and the keyboard rule they share.
 * Both the feed's audience tabs and its ranking pills are built from these.
 */
import { type KeyboardEvent, type ReactNode } from "react";

export function tabKey(key: string, current: number, count: number): number | null {
	if (key === "ArrowRight") return (current + 1) % count;
	if (key === "ArrowLeft") return (current + count - 1) % count;
	if (key === "Home") return 0;
	if (key === "End") return count - 1;
	return null;
}

/**
 * The tab strip. `variant` picks the mockup's presentation: `tabs` is the
 * underlined row the feed puts on the left (`.tabs`), `pills` the rounded
 * filter row it puts on the right (`.pill`).
 *
 */
export function TabHeading({ id, labels, selected, onSelect, variant = "tabs", label }: {
	id: string; labels: readonly string[]; selected: number; onSelect: (index: number) => void;
	variant?: "tabs" | "pills";
	/** Accessible name for the tablist. Defaults to the first tab's label, which
	 *  is what every caller got before this prop existed. */
	label?: string;
}) {
	function keyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		const next = tabKey(event.key, index, labels.length);
		if (next === null) return;
		event.preventDefault();
		onSelect(next);
		const target = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
		target?.focus();
	}
	// `role="group"` only when the caller named the group: without a name the role
	// adds nothing, and every caller that predates the `label` prop renders the
	// bare `.pills` div it always did.
	if (variant === "pills") return <div className="pills" role={label === undefined ? undefined : "group"} aria-label={label}>{labels.map((text, index) => <button key={text} type="button" className="pill" aria-pressed={selected === index} onClick={() => onSelect(index)}>{text}</button>)}</div>;
	return <div className="tabs" role="tablist" aria-label={label ?? labels[0]}>
		{labels.map((text, index) => <button key={text} type="button"
			id={`${id}-tab-${index}`} role="tab" aria-selected={selected === index}
			aria-controls={`${id}-panel`} tabIndex={selected === index ? 0 : -1}
			onClick={() => onSelect(index)} onKeyDown={event => keyDown(event, index)}>{text}</button>)}
	</div>;
}

export function TabPanel({ id, selected, children }: { id: string; selected: number; children: ReactNode }) {
	return <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}>{children}</div>;
}
