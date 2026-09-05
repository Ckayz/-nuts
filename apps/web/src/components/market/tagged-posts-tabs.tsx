"use client";
import { useId, useRef, useState } from "react";
import { CalloutPost } from "@/components/feed/callout-post";
import type { Thesis } from "@/lib/display-types";

export function TaggedPostsTabs({ posts, signedIn = false, databaseMode = false }: { posts: Thesis[]; signedIn?: boolean; databaseMode?: boolean }) {
	const id = useId();
	const [tab, setTab] = useState<"all" | "backed">("all");
	const all = useRef<HTMLButtonElement>(null);
	const backed = useRef<HTMLButtonElement>(null);
	const visible = tab === "all" ? posts : posts.filter(post => post.backing !== null);
	return <>
		<div className="sec-h"><h2 className="h2">Tagged posts</h2><span className="mono dim">{visible.length}</span></div>
		<div className="tabs" role="tablist" aria-label="Tagged posts" onKeyDown={event => {
			if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
			event.preventDefault();
			const next = event.key === "Home" ? "all" : event.key === "End" ? "backed" : tab === "all" ? "backed" : "all";
			setTab(next); (next === "all" ? all : backed).current?.focus();
		}}>{(["all", "backed"] as const).map(value => <button key={value} type="button" role="tab" ref={value === "all" ? all : backed} id={`${id}-${value}`} aria-selected={tab === value} aria-controls={`${id}-panel`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)}>{value === "all" ? "All" : "Backed"}</button>)}</div>
		<div className="feed" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} tabIndex={0}>{visible.map(post => <CalloutPost key={post.slug} thesis={post} signedIn={signedIn} databaseMode={databaseMode} />)}</div>
	</>;
}
