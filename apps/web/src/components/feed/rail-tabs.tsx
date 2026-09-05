"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { TrendingItem } from "@/lib/display-types";
import { TodoOwner } from "@/components/primitives";
import { TrendingList } from "./thesis-list";

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
 * ARIA is unchanged from the previous round — a real `tablist` with roving
 * tabindex, which the keyboard tests in `lib/social/feeds-tabs.test.tsx` pin
 * attribute by attribute. The mockup draws its pills as `aria-pressed`
 * buttons; `index.css` styles `aria-selected` the same way so the look is the
 * mockup's without weakening the semantics.
 */
export function TabHeading({ id, labels, selected, onSelect, variant = "tabs" }: {
	id: string; labels: readonly string[]; selected: number; onSelect: (index: number) => void;
	variant?: "tabs" | "pills";
}) {
	function keyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		const next = tabKey(event.key, index, labels.length);
		if (next === null) return;
		event.preventDefault();
		onSelect(next);
		const target = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
		target?.focus();
	}
	return <div className={variant === "pills" ? "pills" : "tabs"} role="tablist" aria-label={labels[0]}>
		{labels.map((label, index) => <button key={label} type="button" className={variant === "pills" ? "pill" : undefined}
			id={`${id}-tab-${index}`} role="tab" aria-selected={selected === index}
			aria-controls={`${id}-panel`} tabIndex={selected === index ? 0 : -1}
			onClick={() => onSelect(index)} onKeyDown={event => keyDown(event, index)}>{label}</button>)}
	</div>;
}

export function TabPanel({ id, selected, children }: { id: string; selected: number; children: ReactNode }) {
	return <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}>{children}</div>;
}

/**
 * The Trending / Ending / Settled control.
 *
 * MISMATCH between the mockup and the data, reported: the mockup draws these
 * three as filter pills over the post feed, but they are their OWN ranked sets
 * (`View.TrendingItem`, headline + P&L only) and half of them are theses the
 * feed page does not carry — intersecting the two would silently drop rows.
 * So the pills keep selecting their own compact list, which renders directly
 * under them where the control is. Making them a true feed filter needs one
 * shape for both, i.e. a `lib/page-data.ts` change outside this fence.
 */
export function RailTabs({ trending, ending, settled }: {
	trending: TrendingItem[]; ending: TrendingItem[]; settled: TrendingItem[];
}) {
	const [selected, setSelected] = useState(0);
	const id = useId();
	return <>
		<TabHeading id={id} labels={["Trending", "Ending", "Settled"]} selected={selected} onSelect={setSelected} variant="pills" />
		<TabPanel id={id} selected={selected}>
			<TrendingList
				items={[trending, ending, settled][selected] ?? []}
				note={<>Trending and ending rules <TodoOwner /></>}
			/>
		</TabPanel>
	</>;
}
