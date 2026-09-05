"use client";

/**
 * The agent, reachable from anywhere without losing your place.
 *
 * Mounted once in the shell. Closed it is a small control in the corner; open it
 * is a slide-over holding the same `AgentChat` in its panel variant, so there is
 * one chat implementation rather than two that drift.
 *
 * Hidden below 900px on purpose: at that width the market ticket and the
 * composer already own the bottom of the screen, and a floating control would
 * cover the thing the user came to press.
 *
 * TODO-OWNER: the button label, the panel heading and the closed-state copy.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { TodoOwner } from "@/components/primitives";
import { AgentChat } from "./agent-chat";
import "@/styles/agent.css";

const FOCUSABLE = 'input:not([disabled]), a[href], button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * m3 (Opus user-flow tester). The routes that already EMBED `AgentChat`:
 * `/agent` renders it full-page (`app/agent/page.tsx:30`) and `/m/<asset>`
 * renders it as a panel in the right rail (`app/m/[asset]/page.tsx:183`).
 * Opening the launcher there put a second, independent chat on top of the first
 * — two conversations, two turn charges, and the one underneath still visible.
 *
 * The test belongs HERE and not in the shell: `app/layout.tsx` mounts this on
 * every route and is a SERVER component (no "use client"), so it cannot read the
 * pathname. Exported so the rule is testable without a router.
 */
export function launcherHiddenOn(pathname: string): boolean {
	return pathname === "/agent" || pathname.startsWith("/agent/") || pathname === "/m" || pathname.startsWith("/m/");
}

export function AgentLauncher({ asset = null }: { readonly asset?: string | null }) {
	const [open, setOpen] = useState(false);
	const panel = useRef<HTMLDivElement>(null);
	const opener = useRef<Element | null>(null);
	// Read before the early return below, and every hook stays above it, so the
	// hook order is the same on every route.
	const pathname = usePathname();

	useEffect(() => {
		if (!open) return;
		opener.current = document.activeElement;
		panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
		const restore = opener.current;
		return () => {
			if (restore instanceof HTMLElement) restore.focus();
		};
	}, [open]);

	const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Escape") return;
		event.stopPropagation();
		setOpen(false);
	}, []);

	// After the hooks, never before them.
	if (launcherHiddenOn(pathname ?? "")) return null;

	if (!open) {
		return (
			<button
				type="button"
				className="agent-fab"
				onClick={() => setOpen(true)}
				aria-label="Ask the agent"
			>
				<span aria-hidden="true">✦</span>
				Ask
			</button>
		);
	}

	return (
		<div className="agent-slide" onKeyDown={onKeyDown} ref={panel} role="dialog" aria-modal="false" aria-labelledby="agent-slide-title">
			<div className="agent-slide-h">
				<h3 id="agent-slide-title">
					Agent
					<TodoOwner />
				</h3>
				<button type="button" className="dlg-x" onClick={() => setOpen(false)} aria-label="Close">
					×
				</button>
			</div>
			<AgentChat asset={asset} variant="panel" />
		</div>
	);
}
