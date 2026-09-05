"use client";

/**
 * The composer form. A Client Component because it shows the action's result
 * (Next 16 docs, `01-app/02-guides/forms.md`: "To display validation errors or
 * messages, turn the component that defines the `<form>` into a Client
 * Component and use React `useActionState`"). `pending` comes from the same
 * hook and disables the button while the post is in flight.
 *
 * The existing headline/rationale fields remain separate to preserve the
 * action contract. The mockup only shows one textarea; unifying them is not a
 * presentation-only change.
 */
import { useActionState, useState } from "react";
import { Textarea } from "@nuts/ui/components/textarea";
import { TodoOwner } from "@/components/primitives";
import { TradeCards } from "@/components/feed/trade-card";
import type { PnlCard } from "@/lib/display-types";
import type { AssetTag } from "@/lib/thesis/composer-data";
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
	marketsUnavailable,
	siteOrigin,
	presetAsset,
	presetRationale,
	previewCards,
	signedIn,
	databaseMode,
}: {
	/** Tag pills; they come from live book data, never a hardcoded list. */
	assets: AssetTag[];
	marketsUnavailable?: boolean;
	siteOrigin?: string;
	/** `?asset=` from the URL, already validated; null when absent. */
	presetAsset: string | null;
	/** `?link=` turned into rationale text, so the card unfurls immediately. */
	presetRationale: string;
	/** Cards for the positions `presetRationale` links, resolved server-side. */
	previewCards: PnlCard[];
	signedIn: boolean;
	databaseMode: boolean;
}) {
	const [state, formAction, pending] = useActionState(publishPostFromForm, INITIAL);
	const [tag, setTag] = useState(presetAsset);
	const [headline, setHeadline] = useState("");
	const [rationale, setRationale] = useState(presetRationale);

	// The preview only needs to know WHETHER the text still links the position
	// the page resolved; it never resolves anything itself.
	const linked = new Set(extractTradeLinks(`${headline}\n${rationale}`, siteOrigin));
	const cards = previewCards.filter((card) => linked.has(card.id));

	const message = state.error === null ? null : (MESSAGES[state.error] ?? state.error);
	const disabled = pending || !signedIn || !databaseMode;

	return (
		<form action={formAction} className="card pad">
			<div className="card-h"><h3>New thesis</h3><span className="x">Text is required. A trade is optional.<TodoOwner /></span></div>
			<div className="field compose-field">
				<span className="av av-40 av-asset compose-avatar" aria-hidden="true">{signedIn ? "•" : "?"}</span>
				{/* The mockup shows the text itself, not a label above it; the field
				    keeps its accessible name for a screen reader. */}
				<label className="lbl lbl-hidden" htmlFor="post-headline">
					What's your read?
				</label>
				<Textarea
					id="post-headline"
					name="headline"
					value={headline}
					onChange={event => setHeadline(event.target.value)}
					rows={4}
					placeholder="What's your read?"
					required
					className="compose-input"
				/>
				<span className="mut compose-note">
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
					className="compose-input"
				/>
				<span className="mut compose-note">
					Paste a <span className="num">/p/…</span> link to one of your trades and it
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
				{/* TODO-OWNER: live market failure copy. */}
				{marketsUnavailable ? <span className="mut">Markets unavailable. <TodoOwner /></span> : null}
				<input type="hidden" name="taggedAsset" value={tag ?? ""} />
				<div className="pills">
					{assets.map(({ asset, name }) => (
						<button
							key={asset}
							className="pill"
							type="button"
							aria-pressed={tag === asset}
							onClick={() => setTag(tag === asset ? null : asset)}
						>
							<span className="av av-asset" aria-hidden="true">{asset}</span>{name}
						</button>
					))}
				</div>
				<span className="mut compose-note">
					Markets come from live OptionBook liquidity, never a fixed list. Pick a
					structure on the market page once you have tagged one.
				</span>
			</div>


			<button
				type="submit"
				className="btn acc compose-submit"
				disabled={disabled}
				style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
			>
				{pending ? "Posting…" : "Post"}
			</button>

			{signedIn && databaseMode ? null : (
				<span className="mut compose-note" role="status">
					{databaseMode
						? "Sign in with your wallet in the header to post."
						: "This build is serving example data; posting is disabled."}
				</span>
			)}

			<p className="mut compose-note" aria-live="polite" role="status">
				{message}
			</p>

		</form>
	);
}
