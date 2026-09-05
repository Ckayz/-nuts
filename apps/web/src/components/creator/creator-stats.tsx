"use client";
import Link from "next/link";
import { useId, useOptimistic, useState, useTransition } from "react";
import { toggleFollow } from "@/lib/social/actions";
import { Avatar } from "@/components/primitives";
import { countLabel, pnlClass, signedUsd } from "@/lib/format";
import type { Creator } from "@/lib/display-types";

export function CreatorStats({ creator, following = false, signedIn = false, databaseMode = false, self = false, profile = false, compact = false }: { creator: Creator; following?: boolean; signedIn?: boolean; databaseMode?: boolean; self?: boolean; profile?: boolean; compact?: boolean }) {
	const hintId = useId();
	const [local, setLocal] = useState({ following, followers: creator.followerCount });
	const [pending, startTransition] = useTransition();
	const [state, optimistic] = useOptimistic(databaseMode ? { following, followers: creator.followerCount } : local);
	const disabled = pending || self || (databaseMode && (!signedIn || !creator.id));

 // TODO-OWNER: Like/Follow sign-in hint copy.
 // m8: `title` alone is not exposed on a disabled button and is not announced,
 // so the same sentence is also an `aria-describedby` target — the mechanism
 // `components/thesis/comment-form.tsx` already uses. No new words.
 const needsSignIn = databaseMode && !signedIn;
 const follow = self ? null : <>{needsSignIn ? <span id={hintId} className="a11y-hidden">Sign in using the wallet control</span> : null}<button type="button" className={profile ? "btn acc" : "btn out"} aria-pressed={state.following} disabled={disabled} aria-describedby={needsSignIn ? hintId : undefined} title={needsSignIn ? "Sign in using the wallet control" : undefined}
					onClick={() => {
						if (disabled) return;
						const next = { following: !state.following, followers: state.followers === undefined ? undefined : state.followers + (state.following ? -1 : 1) };
						if (!databaseMode) { setLocal(next); return; }
						startTransition(async () => { optimistic(next); try { await toggleFollow(creator.id!, next.following); } catch { /* rollback */ } });
					}}>{state.following ? "Following" : "Follow"}</button></>;
 const stats = <>
  {creator.verifiedPnl30dUsd !== undefined ? <span className="tile"><i>Verified P&amp;L 30d</i><b className={`num ${pnlClass(creator.verifiedPnl30dUsd) === "bear" ? "loss" : pnlClass(creator.verifiedPnl30dUsd) === "bull" ? "gain" : "mut"}`}>{signedUsd(creator.verifiedPnl30dUsd)}</b></span> : null}
  {creator.winRatePct !== undefined ? <span className="tile"><i>Win rate</i><b className="num">{creator.winRatePct}%</b></span> : null}
  {creator.thesesCount !== undefined ? <span className="tile"><i>Theses</i><b className="num">{creator.thesesCount}</b></span> : null}
  {profile && creator.biggestLossUsd !== undefined ? <span className="tile"><i>Biggest loss</i><b className="loss num">{signedUsd(creator.biggestLossUsd)}</b></span> : null}
 </>;
 const followers = state.followers === undefined ? creator.followers : new Intl.NumberFormat("en-US").format(state.followers);
 if (compact) return <div className="row"><Avatar seed={creator.avatarSeed} initials={creator.initials} size="s" /><span className="t"><Link href={`/u/${creator.handle}`}><b>{creator.displayName}</b></Link><i className={`num ${pnlClass(creator.netPnlUsd) === "bear" ? "loss" : pnlClass(creator.netPnlUsd) === "bull" ? "gain" : "mut"}`}>{signedUsd(creator.netPnlUsd)}</i></span>{follow}</div>;
 return <section className={profile ? "card pad profile-header" : "card creator-card"}>
  {!profile ? <div className="card-h"><h3>Creator</h3><span className="x">{follow}</span></div> : null}
  <div className={profile ? "prof" : "card-b"}>
   <div className={profile ? "profile-avatar" : "row"}>
    <Avatar seed={creator.avatarSeed} initials={creator.initials} size={profile ? "lg" : undefined} />
    {!profile ? <span className="t"><Link href={`/u/${creator.handle}`}><b>{creator.displayName}</b></Link><i>{[creator.walletAddress, creator.sinceLabel].filter(Boolean).join(" · ")}</i></span> : null}
   </div>
   {profile ? <><div className="profile-identity"><h1>{creator.displayName}</h1><div className="handle">@{creator.handleLabel}</div><div className="meta num">{[creator.walletAddress, creator.sinceLabel].filter(Boolean).join(" · ")}</div><div className="counts">{followers !== undefined ? <span><b className="num">{followers}</b> {countLabel(state.followers, "Followers", "Follower")}</span> : null}{creator.thesesCount !== undefined ? <span><b className="num">{creator.thesesCount}</b> {countLabel(creator.thesesCount, "Theses", "Thesis")}</span> : null}</div></div><div className="prof-act">{!self ? follow : null}</div></> : null}
  </div>
  <div className={profile ? "stats" : "creator-metrics"}>{stats}{!profile && followers !== undefined ? <span className="tile"><i>Followers</i><b className="num">{followers}</b></span> : null}</div>
 </section>;
}
