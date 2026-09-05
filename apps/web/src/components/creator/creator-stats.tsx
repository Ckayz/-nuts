"use client";
import { useOptimistic, useState, useTransition } from "react";
import { toggleFollow } from "@/lib/social/actions";
import { Avatar } from "@/components/primitives";
import { pnlClass, signedUsd } from "@/lib/format";
import type { Creator } from "@/lib/display-types";

export function CreatorStats({ creator, following = false, signedIn = false, databaseMode = false, self = false }: { creator: Creator; following?: boolean; signedIn?: boolean; databaseMode?: boolean; self?: boolean }) {
	const [local, setLocal] = useState({ following, followers: creator.followerCount });
	const [pending, startTransition] = useTransition();
	const [state, optimistic] = useOptimistic(databaseMode ? { following, followers: creator.followerCount } : local);
	const disabled = pending || self || (databaseMode && (!signedIn || !creator.id));
	return (
		<div className="sec">
			<div className="sec-h">
				<span className="lbl">Creator</span>
				<button type="button" className="btn sm" aria-pressed={state.following} disabled={disabled}
					title={databaseMode && !signedIn ? "Sign in using the wallet control" : undefined}
					onClick={() => {
						if (disabled) return;
						const next = { following: !state.following, followers: state.followers === undefined ? undefined : state.followers + (state.following ? -1 : 1) };
						if (!databaseMode) { setLocal(next); return; }
						startTransition(async () => { optimistic(next); try { await toggleFollow(creator.id!, next.following); } catch { /* rollback */ } });
					}}>
					Follow
				</button>
			</div>
			<div className="lb">
				<div
					className="row creator-row"
				>
					<Avatar initials={creator.initials} size="lg" />
					<span className="who">
						<span className="n">{creator.displayName}</span>
						<span className="h">
							{[creator.walletAddress, creator.sinceLabel]
								.filter(Boolean)
								.join(" · ")}
						</span>
					</span>
				</div>
			</div>
			<dl className="kv">
				{creator.verifiedPnl30dUsd !== undefined ? (
					<>
						<dt>Verified P&amp;L 30d</dt>
						<dd className={pnlClass(creator.verifiedPnl30dUsd)}>
							{signedUsd(creator.verifiedPnl30dUsd)}
						</dd>
					</>
				) : null}
				{creator.winRatePct !== undefined ? (
					<>
						<dt>Win rate</dt>
						<dd>{creator.winRatePct}%</dd>
					</>
				) : null}
				{creator.thesesCount !== undefined ? (
					<>
						<dt>Theses</dt>
						<dd>{creator.thesesCount}</dd>
					</>
				) : null}
				{creator.followers !== undefined ? (
					<>
						<dt>Followers</dt>
						<dd>{state.followers === undefined ? creator.followers : new Intl.NumberFormat("en-US").format(state.followers)}</dd>
					</>
				) : null}
				{creator.biggestLossUsd !== undefined ? (
					<>
						<dt>Biggest loss</dt>
						<dd className={pnlClass(creator.biggestLossUsd)}>
							{signedUsd(creator.biggestLossUsd)}
						</dd>
					</>
				) : null}
			</dl>
			<span className="note">
				Every figure from onchain fills and settlements. Losing theses cannot be
				deleted.
			</span>
		</div>
	);
}
