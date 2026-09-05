"use client";

import "@/styles/position.css";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Copy the supplied canonical post/position path, or the current page URL.
 *
 * The origin comes from the browser rather than from the server: the
 * server would have to trust the `Host` header to build an absolute URL, and the
 * browser already knows the exact address the visitor is on.
 *
 * `navigator.clipboard` is unavailable on insecure origins and can be refused by
 * permissions, so the fallback is a real one: the URL is revealed in a focused,
 * selected, read-only input the visitor can copy by hand. It never silently
 * reports success it did not achieve.
 */
export function CopyLink({ label = "Copy link", path, className = "btn sec" }: { label?: React.ReactNode; path?: string; className?: string }) {
	const inputId = useId();
	const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
	const [url, setUrl] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	// The href is only known in the browser; reading it in an effect keeps the
	// server and the first client render identical.
	useEffect(() => {
		setUrl(path ? new URL(path, window.location.origin).href : window.location.href);
	}, [path]);

	useEffect(() => {
		if (state === "manual") inputRef.current?.select();
	}, [state]);

	async function copy() {
		const href = path ? new URL(path, window.location.origin).href : window.location.href;
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
		<span className="copy">
			<button type="button" className={className} onClick={copy} aria-live="polite">
				{state === "copied" ? "Link copied" : label}
			</button>
			{state === "manual" ? (
				<>
					<label className="copy-fallback" htmlFor={inputId}>
						Copying was blocked by the browser. Select and copy this address:
					</label>
					<input
						id={inputId}
						ref={inputRef}
						className="copy-url num"
						readOnly
						value={url}
						onFocus={(event) => event.currentTarget.select()}
					/>
				</>
			) : null}
		</span>
	);
}
