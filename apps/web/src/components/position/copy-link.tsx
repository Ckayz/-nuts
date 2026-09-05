"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Copy link" for a position's own page.
 *
 * The URL comes from `window.location.href` rather than from the server: the
 * server would have to trust the `Host` header to build an absolute URL, and the
 * browser already knows the exact address the visitor is on.
 *
 * `navigator.clipboard` is unavailable on insecure origins and can be refused by
 * permissions, so the fallback is a real one: the URL is revealed in a focused,
 * selected, read-only input the visitor can copy by hand. It never silently
 * reports success it did not achieve.
 */
export function CopyLink({ label = "Copy link" }: { label?: string }) {
	const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
	const [url, setUrl] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	// The href is only known in the browser; reading it in an effect keeps the
	// server and the first client render identical.
	useEffect(() => {
		setUrl(window.location.href);
	}, []);

	useEffect(() => {
		if (state === "manual") inputRef.current?.select();
	}, [state]);

	async function copy() {
		const href = window.location.href;
		setUrl(href);
		try {
			if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
			await navigator.clipboard.writeText(href);
			setState("copied");
		} catch {
			setState("manual");
		}
	}

	return (
		<span style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
			<button type="button" className="btn" onClick={copy} aria-live="polite">
				{state === "copied" ? "Link copied" : label}
			</button>
			{state === "manual" ? (
				<>
					<label className="note" htmlFor="position-share-url">
						Copying was blocked by the browser. Select and copy this address:
					</label>
					<input
						id="position-share-url"
						ref={inputRef}
						className="mono"
						readOnly
						value={url}
						onFocus={(event) => event.currentTarget.select()}
						style={{
							background: "var(--tn-s2)",
							border: "1px solid var(--tn-l2)",
							borderRadius: "8px",
							padding: "8px 10px",
							color: "var(--tn-k)",
							fontSize: "12px",
							width: "100%",
						}}
					/>
				</>
			) : null}
		</span>
	);
}
