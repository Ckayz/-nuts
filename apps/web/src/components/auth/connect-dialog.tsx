"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

/** wagmi's `injected()` with no target reports this id (measured in
 * `@wagmi/core/dist/esm/connectors/injected.js`: the no-target branch returns
 * `{ id: "injected", name: "Injected" }`). */
const GENERIC_INJECTED_ID = "injected";

/**
 * An EIP-6963 announcement, as opposed to the generic browser-provider fallback.
 *
 * `createConfig` turns each announced provider into `injected({ target: { ...info,
 * id: info.rdns } })` (`@wagmi/core/dist/esm/createConfig.js:76`), so a discovered
 * wallet has `type === "injected"` and an rdns id such as `io.metamask`. SDK
 * connectors (Coinbase) carry their own type and are never announcements.
 */
function isAnnouncedInjected(connector: Connector): boolean {
	return connector.type === "injected" && connector.id !== GENERIC_INJECTED_ID;
}

/**
 * One row per wallet, not one per connector.
 *
 * wagmi leaves `multiInjectedProviderDiscovery` on by default, so a browser with
 * MetaMask installed yields the configured `injected()` connector (whose name is
 * the literal string "Injected"), the configured Coinbase connector, and an
 * EIP-6963 discovery for each — the same wallet listed twice under two names.
 *
 * The generic `injected` connector is dropped only when an EIP-6963 provider has
 * actually announced itself, because such a connector names itself properly and
 * carries an icon. It is NOT dropped merely because some other connector exists:
 * `lib/wagmi.ts` always configures the Coinbase SDK connector, and the earlier
 * "anything that is not `injected` counts as discovered" test evicted the generic
 * fallback in every browser, so a wallet that only sets `window.ethereum` without
 * announcing itself had no selectable row at all (measured: `configured
 * injected,coinbaseWalletSDK` → `offered coinbaseWalletSDK`).
 */
export function walletChoices(connectors: readonly Connector[]): Connector[] {
	const announced = connectors.some(isAnnouncedInjected);
	const pool = announced
		? connectors.filter((c) => !(c.type === "injected" && c.id === GENERIC_INJECTED_ID))
		: [...connectors];

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

/**
 * D-R3-2 (Astra lane D, pass 3). WHERE the dialog is mounted, not just how it is
 * styled.
 *
 * It used to render inside `WalletBar`, which is inside the sticky top bar. That
 * header is `position:sticky; z-index:30` (`index.css:75`), so it creates its
 * own stacking context and the scrim's `z-index:60` (`index.css:512`) could only
 * ever compete INSIDE it. The agent launcher and its panel are `position:fixed;
 * z-index:38` (`styles/agent.css:84,91`) at document level, so they painted
 * above the "modal" and stayed clickable through it. Measured by the reviewer:
 *   {"modalInsideHeader":true,"launcherOutsideHeader":true,
 *    "headerZ":30,"scrimZ":60,"launcherZ":38}
 *
 * `#modal-root` is the last child of `<body>` (`app/layout.tsx`), so the scrim
 * lands in the ROOT stacking context, where 60 does beat 38. `document.body` is
 * the fallback for any tree that does not render the layout.
 *
 * Null with no document at all — server rendering, and `renderToStaticMarkup` in
 * the tests — and the dialog is then returned in place exactly as before, which
 * is also the only correct answer there: there is nothing to portal INTO.
 */
function modalHost(): Element | null {
	if (typeof document === "undefined") return null;
	return document.getElementById("modal-root") ?? document.body;
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

	// Resolved on the FIRST client render, not in an effect: an effect runs after
	// paint, which would show one frame of the dialog trapped in the header.
	const [host] = useState(modalHost);

	const scrim = (
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

	return host === null ? scrim : createPortal(scrim, host);
}
