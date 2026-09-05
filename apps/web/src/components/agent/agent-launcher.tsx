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

import { TodoOwner } from "@/components/primitives";
import { AgentChat } from "./agent-chat";
import "@/styles/agent.css";

const FOCUSABLE = 'input:not([disabled]), a[href], button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AgentLauncher({ asset = null }: { readonly asset?: string | null }) {
	const [open, setOpen] = useState(false);
	const panel = useRef<HTMLDivElement>(null);
	const opener = useRef<Element | null>(null);

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
