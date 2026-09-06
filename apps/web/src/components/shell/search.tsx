"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { SearchIcon } from "@/components/icons";
import { Avatar } from "@/components/primitives";
import { searchAll } from "@/lib/search/actions";
import { normalizeQuery, SEARCH_QUERY_LIMIT, type SearchResults } from "@/lib/search/query";
import { searchKey } from "@/lib/search/keyboard";

// TODO-OWNER: debounce and search/status wording; scope excludes theses.
const DEBOUNCE_MS = 250;
const LABEL = "Search markets and people";
export function Search() {
	const id = useId();
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const generation = useRef(0);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchResults | null>(null);
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState(-1);
	useEffect(() => {
		const shortcut = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k" || event.altKey) return;
			const target = event.target;
			if (target instanceof HTMLElement && target !== input.current &&
				(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") || target.isContentEditable)) return;
			if (!input.current?.getClientRects().length) return;
			event.preventDefault(); input.current.focus();
		};
		window.addEventListener("keydown", shortcut);
		return () => window.removeEventListener("keydown", shortcut);
	}, []);
	useEffect(() => {
		const version = generation.current;
		if (!normalizeQuery(query)) return;
		let cancelled = false;
		const timer = setTimeout(() => {
			void searchAll(query).catch(() => ({ markets: [], people: [], unavailable: true } as SearchResults))
				.then(value => { if (!cancelled && generation.current === version) setResults(value); });
		}, DEBOUNCE_MS);
		return () => { cancelled = true; clearTimeout(timer); };
	}, [query]);
	const count = (results?.markets.length ?? 0) + (results?.people.length ?? 0);
	const visible = open && normalizeQuery(query) !== null;
	useEffect(() => {
		if (visible && selected >= 0) list.current?.querySelectorAll<HTMLElement>('[role="option"]')[selected]?.scrollIntoView({ block: "nearest" });
	}, [selected, visible]);
	return <div className="search" onBlur={event => {
		if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
	}}>
		<SearchIcon style={{ width: "15px", height: "15px", flexShrink: 0 }} />
		<input ref={input} type="search" role="combobox" aria-label={LABEL} placeholder={LABEL}
			aria-autocomplete="list" aria-expanded={visible} aria-controls={visible ? `${id}-results` : undefined}
			aria-activedescendant={visible && selected >= 0 ? `${id}-option-${selected}` : undefined}
			maxLength={SEARCH_QUERY_LIMIT} value={query} onFocus={() => setOpen(true)}
			onChange={event => { generation.current++; setQuery(event.target.value); setResults(null); setSelected(-1); setOpen(true); }}
			onKeyDown={event => {
				const next = searchKey(event.key, selected, visible ? count : 0);
				if (next === null) return;
				event.preventDefault();
				if (next === "close") { setOpen(false); setSelected(-1); }
				else if (next === "open") list.current?.querySelectorAll<HTMLAnchorElement>('[role="option"]')[selected < 0 ? 0 : selected]?.click();
				else setSelected(next);
			}} />
		<kbd>⌘ K</kbd>
		{visible && <div className="search-results">
			<SearchList id={`${id}-results`} optionPrefix={id} results={results} selected={selected} listRef={list}
				onChoose={() => { setOpen(false); setSelected(-1); }} />
		</div>}
	</div>;
}

export function SearchList({ id, optionPrefix, results, selected, listRef, onChoose }: {
	id: string; optionPrefix: string; results: SearchResults | null; selected: number;
	listRef?: React.Ref<HTMLDivElement>; onChoose: () => void;
}) {
	let index = 0;
	const groups = [
		{ label: "Markets", rows: results?.markets.map(market => ({ href: `/m/${encodeURIComponent(market.slug)}` as `/m/${string}`, displayName: market.name, label: market.asset, asset: market.asset, avatarSeed: undefined, initials: market.asset.slice(0, 2), tone: "asset" as const })) ?? [] },
		{ label: "People", rows: results?.people.map(person => ({ ...person, asset: undefined, label: `@${person.handleLabel}`, tone: "person" as const })) ?? [] },
	];
	return <>
		<div id={id} ref={listRef} role="listbox" aria-label={LABEL} aria-busy={results === null}>
			{groups.filter(group => group.rows.length).map(group => <div key={group.label} role="group" aria-label={group.label}>
				<div className="search-group" aria-hidden="true">{group.label}</div>
				{group.rows.map(row => { const current = index++; return <Link key={row.href} href={row.href} prefetch={false}
					role="option" id={`${optionPrefix}-option-${current}`} aria-selected={selected === current}
					tabIndex={-1} className="search-option" onMouseDown={event => event.preventDefault()} onClick={onChoose}>
					<Avatar asset={row.asset} seed={row.avatarSeed} initials={row.initials} tone={row.tone} />{/* K-2 (pass-4 D4-m9): the second line is dropped when it repeats the first.
					    A market's `name` is its SYMBOL in database mode — the Thetanuts SDK
					    publishes ticker symbols and no full names (`lib/market/summaries.ts`),
					    so these rows read "ETH" over "ETH". Inventing a name would be worse;
					    printing it twice is noise. A person's "@handle" always differs, and a
					    fixture market ("Bitcoin" over "BTC") still shows both. */}<span><strong>{row.displayName}</strong>{row.label === row.displayName ? null : <small>{row.label}</small>}</span>
				</Link>; })}
			</div>)}
		</div>
		{/* TODO-OWNER: pending, unavailable and no-results copy. */}
		{index === 0 && <p className="search-status" role="status">{results === null ? "Searching…" : results.unavailable ? "Search is unavailable. Try again." : "No matching markets or people."}</p>}
	</>;
}
