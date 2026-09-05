"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { TrendingItem } from "@/lib/display-types";
import { TrendingList } from "./thesis-list";

export function tabKey(key: string, current: number, count: number): number | null {
	if (key === "ArrowRight") return (current + 1) % count;
	if (key === "ArrowLeft") return (current + count - 1) % count;
	if (key === "Home") return 0;
	if (key === "End") return count - 1;
	return null;
}

/** Section-header typography and .alt spacing from the mockup. */
export function TabHeading({ id, labels, selected, onSelect }: {
	id: string; labels: readonly string[]; selected: number; onSelect: (index: number) => void;
}) {
	function keyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		const next = tabKey(event.key, index, labels.length);
		if (next === null) return;
		event.preventDefault();
		onSelect(next);
		const target = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
		target?.focus();
	}
	return <div className="h2" role="tablist" aria-label={labels[0]}>
		{labels.map((label, index) => <button key={label} type="button" className={index ? "alt" : undefined}
			id={`${id}-tab-${index}`} role="tab" aria-selected={selected === index}
			aria-controls={`${id}-panel`} tabIndex={selected === index ? 0 : -1}
			style={{ color: selected === index ? "var(--tn-acc)" : "var(--tn-m)", fontWeight: selected === index ? 800 : 600 }}
			onClick={() => onSelect(index)} onKeyDown={event => keyDown(event, index)}>{label}</button>)}
	</div>;
}

export function TabPanel({ id, selected, children }: { id: string; selected: number; children: ReactNode }) {
	return <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}>{children}</div>;
}

export function RailTabs({ trending, ending, settled }: {
	trending: TrendingItem[]; ending: TrendingItem[]; settled: TrendingItem[];
}) {
	const [selected, setSelected] = useState(0);
	const id = useId();
	return <>
		<div className="sec-h"><TabHeading id={id} labels={["Trending", "Ending", "Settled"]} selected={selected} onSelect={setSelected} /></div>
		<TabPanel id={id} selected={selected}><TrendingList items={[trending, ending, settled][selected] ?? []} /></TabPanel>
	</>;
}
