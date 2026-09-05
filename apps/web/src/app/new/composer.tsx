"use client";

/**
 * The composer form. A Client Component because it shows the action's result
 * (Next 16 docs, `01-app/02-guides/forms.md`: "To display validation errors or
 * messages, turn the component that defines the `<form>` into a Client
 * Component and use React `useActionState`"). `pending` comes from the same
 * hook and disables the button while the post is in flight.
 *
 * The mockup specifies no composer copy beyond the rail button's title "Launch
 * a thesis" (docs/mockups/thesis-fun-mockup.html), so the labels below are the
 * ones the page already carried; every one of them is still the owner's to set.
 */
import { useActionState, useState } from "react";
import { Textarea } from "@nuts/ui/components/textarea";
import { Pill, TodoOwner } from "@/components/primitives";
import { TradeCards } from "@/components/feed/trade-card";
import type { TradeCard } from "@/lib/display-types";
import { publishPostFromForm } from "@/lib/thesis/actions";
import type { PublishFormState } from "@/lib/thesis/form-state";
import { extractTradeLinks } from "@/lib/thesis/links";

/** Machine reasons from the action, mapped to the shortest honest sentence. */
const MESSAGES: Record<string, string> = {
	sign_in_required: "Sign in with your wallet first — the header has the control.",
	mock_mode: "This build is serving example data, so nothing can be published.",
	blank_headline: "A post needs some text.",
	invalid_tag: "That market tag is not a ticker.",
	slug_conflict: "Could not allocate a link for this post. Try again.",
};

const INITIAL: PublishFormState = { error: null };

export function Composer({
	assets,
	presetAsset,
	presetRationale,
	previewCards,
	signedIn,
	databaseMode,
}: {
	/** Tickers offered as tag pills; they come from live book data, never a list. */
	assets: string[];
	/** `?asset=` from the URL, already validated; null when absent. */
	presetAsset: string | null;
	/** `?link=` turned into rationale text, so the card unfurls immediately. */
	presetRationale: string;
	/** Cards for the positions `presetRationale` links, resolved server-side. */
	previewCards: TradeCard[];
	signedIn: boolean;
	databaseMode: boolean;
}) {
	const [state, formAction, pending] = useActionState(publishPostFromForm, INITIAL);
	const [tag, setTag] = useState(presetAsset);
	const [rationale, setRationale] = useState(presetRationale);

	// The preview only needs to know WHETHER the text still links the position
	// the page resolved; it never resolves anything itself.
	const linked = new Set(extractTradeLinks(rationale));
	const cards = previewCards.filter((card) => linked.has(card.positionId));

	const message = state.error === null ? null : (MESSAGES[state.error] ?? state.error);
	const disabled = pending || !signedIn || !databaseMode;

	return (
		<form action={formAction} className="panel" style={{ maxWidth: "480px" }}>
			<h3>Write a post</h3>
			<div className="field">
				<label className="lbl" htmlFor="post-headline">
					Your call
				</label>
				<Textarea
					id="post-headline"
					name="headline"
					rows={4}
					required
					className="rounded-[9px] border-[var(--tn-l2)] bg-[var(--tn-g)] px-3 py-[9px] text-[13px] text-[var(--tn-k)]"
				/>
				<span className="note">
					Composer copy, length limits and posting rules <TodoOwner />
				</span>
			</div>

			<div className="field">
				<label className="lbl" htmlFor="post-rationale">
					Why (optional)
				</label>
				<Textarea
					id="post-rationale"
					name="rationale"
					rows={3}
					value={rationale}
					onChange={(event) => setRationale(event.target.value)}
					className="rounded-[9px] border-[var(--tn-l2)] bg-[var(--tn-g)] px-3 py-[9px] text-[13px] text-[var(--tn-k)]"
				/>
				<span className="note">
					Paste a <span className="mono">/p/…</span> link to one of your trades and it
					renders as a card under the post.
				</span>
			</div>

			{cards.length > 0 ? (
				<div className="field">
					<span className="lbl">Preview</span>
					<TradeCards cards={cards} />
				</div>
			) : null}

			<div className="field">
				<span className="lbl">Tag a market (optional)</span>
				<input type="hidden" name="taggedAsset" value={tag ?? ""} />
				<div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
					{assets.map((asset) => (
						<button
							key={asset}
							type="button"
							aria-pressed={tag === asset}
							onClick={() => setTag(tag === asset ? null : asset)}
						>
							<Pill on={tag === asset}>{asset}</Pill>
						</button>
					))}
				</div>
				<span className="note">
					Markets come from live OptionBook liquidity, never a fixed list. Pick a
					structure on the market page once you have tagged one.
				</span>
			</div>

			{/* `.btn.primary` has no disabled style and `src/index.css` belongs to
			    another worker this round, so the unavailable state is dimmed
			    inline rather than left looking clickable. */}
			<button
				type="submit"
				className="btn primary block"
				disabled={disabled}
				style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
			>
				{pending ? "Posting…" : "Post"}
			</button>

			{signedIn && databaseMode ? null : (
				<span className="note" role="status">
					{databaseMode
						? "Sign in with your wallet in the header to post."
						: "This build is serving example data; posting is disabled."}
				</span>
			)}

			<p className="note" aria-live="polite" role="status">
				{message}
			</p>

			<span className="note">
				A post is text. It shows the verified badge only after your own fill on the
				market page confirms onchain.
			</span>
		</form>
	);
}
