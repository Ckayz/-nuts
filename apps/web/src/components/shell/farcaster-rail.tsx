import { Avatar } from "@/components/primitives";
import type { FarcasterRailState } from "@/lib/farcaster/casts";

/**
 * The "From Farcaster" rail: live casts from Neynar, drawn in the same idiom as
 * `feed-rail.tsx` (`.card` / `.card-h` / `.card-b` / `.rail-post`) but LABELLED
 * as somebody else's network, so it can never be read as this app's own feed.
 *
 * Presentational on purpose, exactly like `FeedRail`: the page does the read and
 * passes state in, so the Neynar key stays inside `lib/farcaster/casts.ts`
 * (`server-only`) and never crosses into a client bundle.
 *
 * Three states, three honest outcomes — there is no skeleton and no placeholder
 * cast, because both would imply data that is not coming:
 *   unconfigured  no key is set, so nothing was requested;
 *   unavailable   a request was made and the answer could not be read;
 *   ready         real casts, or a plainly-stated quiet channel.
 */
export function FarcasterRail({ state }: { state: FarcasterRailState }) {
	return (
		<section className="card" aria-labelledby="farcaster-rail-heading">
			<div className="card-h">
				<h2 id="farcaster-rail-heading">From Farcaster</h2>
				<span className="x">Not Thesis.fun</span>
			</div>
			<div className="card-b">{body(state)}</div>
			<div className="card-f">
				{/* TODO-OWNER: attribution wording. */}
				Public casts, read live from Farcaster via Neynar. Posts, not theses.
			</div>
		</section>
	);
}

function body(state: FarcasterRailState) {
	// TODO-OWNER: all three lines below are provisional copy.
	if (state.status === "unconfigured") {
		return <p className="note">The Farcaster feed is not configured, so there is nothing live to show here.</p>;
	}
	if (state.status === "unavailable") {
		return <p className="note">The Farcaster feed could not be read just now. Nothing here is a stand-in for it.</p>;
	}
	if (state.casts.length === 0) {
		return <p className="note">Nothing on Farcaster matched the markets this rail watches.</p>;
	}
	return state.casts.map((cast) => {
		const name = cast.displayName ?? cast.username;
		const row = (
			<>
				{/* D-N2 (lane D confirming pass). GENERATED avatar only, never
				    `cast.avatarUrl`. Two reasons, both measured: the app's avatar
				    contract is local DiceBear SVGs with no network (owner
				    2026-09-05), and `Avatar` renders a remote `src` with no error
				    handler, so a dead Farcaster picture drew a broken image. The
				    parsed cast still CARRIES `avatarUrl` (unused here) so remote
				    pictures can be turned back on without re-deriving it. */}
				<Avatar initials={initials(name)} seed={cast.username} size={30} />
				<div className="t">
					<div className="n">
						{name}
						<span>@{cast.username}</span>
					</div>
					<p>{cast.text}</p>
					{cast.channelId === null ? null : <span className="m">/{cast.channelId}</span>}
				</div>
			</>
		);
		// A cast whose hash is too short to build a permalink from is still shown,
		// just not as a link — a dead link would be worse than none.
		return cast.url === null ? (
			<div className="rail-post" key={cast.hash}>
				{row}
			</div>
		) : (
			<a className="rail-post" href={cast.url} key={cast.hash} target="_blank" rel="noreferrer noopener">
				{row}
			</a>
		);
	});
}

/**
 * The monogram behind a Farcaster avatar. Same one-or-two letter shape the app's
 * own avatars use; it shows only when the generated avatar cannot be built.
 */
export function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "?";
	const letters =
		words.length === 1
			? (words[0] ?? "").slice(0, 2)
			: `${(words[0] ?? "").slice(0, 1)}${(words[1] ?? "").slice(0, 1)}`;
	return letters.toUpperCase();
}
