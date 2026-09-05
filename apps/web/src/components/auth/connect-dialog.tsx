"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Connector } from "wagmi";

import { TodoOwner } from "@/components/primitives";

/**
 * The wallet picker.
 *
 * It was a bare `<details>` listing `connector.name` — which renders the string
 * "Injected" as if it were a wallet, shows the same wallet twice when EIP-6963
 * discovery finds a connector that is also configured, and offers no icons. A
 * click with no wallet installed did nothing at all, because the caller never
 * read `useConnect().error`.
 *
 * `packages/ui` has no dialog, and its `dropdown-menu` is shadcn/Base-UI styled
 * with `rounded-none` and `shadow-md`, both of which contradict this app's rules
 * (radius by role, hairlines not shadows). So this follows the same hand-rolled
 * pattern as `components/market/fill-dialog.tsx`: `role="dialog"`, `aria-modal`,
 * labelled by its heading, focus moved in on open, Escape and backdrop close,
 * focus cycled inside, focus returned to the opener.
 */

const FOCUSABLE = 'input:not([disabled]), a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * One row per wallet, not one per connector.
 *
 * wagmi leaves `multiInjectedProviderDiscovery` on by default, so a browser with
 * MetaMask installed yields the configured `injected()` connector (whose name is
 * the literal string "Injected"), the configured Coinbase connector, and an
 * EIP-6963 discovery for each — the same wallet listed twice under two names.
 *
 * The generic `injected` connector is dropped whenever any discovered connector
 * exists, because a discovered one always names itself properly and carries an
 * icon. It is kept when nothing was discovered, so a browser wallet that does
 * not announce itself is still reachable.
 */
export function walletChoices(connectors: readonly Connector[]): Connector[] {
	const discovered = connectors.filter((c) => c.id !== "injected");
	const pool = discovered.length > 0 ? discovered : [...connectors];

	const seen = new Set<string>();
	const choices: Connector[] = [];
	for (const connector of pool) {
		// Two connectors for one wallet share a name even when their ids differ.
		const key = connector.name.trim().toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		choices.push(connector);
	}
	return choices;
}

export function ConnectDialog({
	connectors,
	pending,
	error,
	onSelect,
	onClose,
}: {
	readonly connectors: readonly Connector[];
	readonly pending: boolean;
	readonly error: string | null;
	readonly onSelect: (connector: Connector) => void;
	readonly onClose: () => void;
}) {
	const panel = useRef<HTMLDivElement>(null);
	const opener = useRef<Element | null>(null);

	useEffect(() => {
		opener.current = document.activeElement;
		panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
		const restore = opener.current;
		return () => {
			if (restore instanceof HTMLElement) restore.focus();
		};
	}, []);

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
				return;
			}
			if (event.key !== "Tab") return;
			const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
			const first = items[0];
			const last = items[items.length - 1];
			if (first === undefined || last === undefined) return;
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		},
		[onClose],
	);

	const choices = walletChoices(connectors);

	return (
		<div
			className="scrim"
			onKeyDown={onKeyDown}
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className="dlg" role="dialog" aria-modal="true" aria-labelledby="connect-dialog-title" ref={panel}>
				<div className="dlg-h">
					<h3 id="connect-dialog-title">
						Connect a wallet
						<TodoOwner />
					</h3>
					<button type="button" className="dlg-x" onClick={onClose} aria-label="Close">
						×
					</button>
				</div>

				<div className="stack">
					{choices.map((connector) => (
						<button
							type="button"
							key={connector.uid}
							className="btn sec block wallet-choice"
							disabled={pending}
							onClick={() => onSelect(connector)}
						>
							{connector.icon === undefined ? null : (
								// eslint-disable-next-line @next/next/no-img-element -- connector icons are data: URIs from the wallet itself
								<img src={connector.icon} alt="" width={20} height={20} aria-hidden="true" />
							)}
							{connector.name}
						</button>
					))}

					{choices.length === 0 ? (
						<p className="fine">
							No wallet detected in this browser. Install a Base-compatible wallet, then reopen
							this. <TodoOwner />
						</p>
					) : null}

					{error === null ? (
						<p className="fine">
							Connecting costs no gas. You will be asked to sign a message afterwards to prove the
							address is yours. <TodoOwner />
						</p>
					) : (
						<p className="fine" role="status">
							{error}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
