import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityList } from "@/components/creator/activity-list";
import { CreatorStats } from "@/components/creator/creator-stats";
import { LikeButton } from "@/components/feed/like-button";
import { CommentIcon, ShareIcon, SparkIcon } from "@/components/icons";
import { Avatar, Pill, SplitBar, StatusChip, TagRow } from "@/components/primitives";
import { CommentsList } from "@/components/thesis/comments-list";
import { ParticipantsTable } from "@/components/thesis/participants-table";
import { PayoffChart } from "@/components/thesis/payoff-chart";
import { SharePanel } from "@/components/thesis/share-panel";
import { SpotChart } from "@/components/thesis/spot-chart";
import { ThesisTabs } from "@/components/thesis/thesis-tabs";
import { signedUsd, usd } from "@/lib/format";
import { thesisDetailData } from "@/lib/page-data";

/**
 * The post thread. Owner 2026-09-05: a thesis is a post, so this page shows the
 * post, what it names, whether the creator backed it, and the replies. There is
 * no ticket here — the right rail links to the market page instead.
 */
/**
 * Rendered per request, never from a build-time cache.
 *
 * In `DATA_SOURCE=db` the rows behind this page change after the build: new
 * comments and participants arrive, and a thesis first requested while it is a
 * `draft` 404s — a cached 404 would then outlive publication and the page would
 * never appear. Segment config has to be a static string (Next refuses a
 * computed one), so this applies in mock mode too, where it costs a render of
 * fixtures that cannot change. A `revalidate` interval would be an owner's
 * number and is deliberately not used.
 */
export const dynamic = "force-dynamic";

export default async function ThesisPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const detail = await thesisDetailData(slug);
	if (!detail) notFound();
	const t = detail.thesis;
	const backing = t.backing;

	return (
		<div className="work">
			<aside className="col l">
				<CreatorStats creator={t.creator} />
				{detail.activity.length > 0 ? (
					<ActivityList items={detail.activity} count={detail.activityCount} />
				) : null}
			</aside>

			<main className="col">
				<header className="hero">
					<div>
						<div
							style={{
								display: "flex",
								gap: "6px",
								marginBottom: "12px",
								alignItems: "center",
								flexWrap: "wrap",
							}}
						>
							{t.asset ? <Pill on>{t.asset}</Pill> : null}
							{t.structure ? (
								<>
									<Pill on>
										{t.structure.productType.charAt(0).toUpperCase()}
										{t.structure.productType.slice(1)}
									</Pill>
									<Pill>{t.structure.venueLabel}</Pill>
								</>
							) : (
								<Pill>Text only</Pill>
							)}
							{t.status && t.statusLabel ? (
								<StatusChip
									status={t.status}
									label={t.statusLabel}
									style={{ marginLeft: "4px" }}
								/>
							) : null}
						</div>
						<h1 className="h">{t.headline}</h1>
						{t.note ? <p className="t">{t.note}</p> : null}
						<div className="meta">
							<Avatar initials={t.creator.initials} size="s" />
							<b>{t.creator.displayName}</b>
							<span>{detail.launchedLabel}</span>
							{detail.expiryLabel ? (
								<>
									<span>·</span>
									<span>
										expires <b className="mono">{detail.expiryLabel}</b>
									</span>
								</>
							) : null}
							{detail.settlementLabel !== null ? (
								<>
									<span>·</span>
									<span>{detail.settlementLabel}</span>
								</>
							) : null}
							<button
								type="button"
								className="acts ai"
								style={{
									display: "inline-flex",
									gap: "6px",
									color: "var(--tn-m)",
								}}
							>
								<SparkIcon style={{ width: "12px", height: "12px" }} />
								Explain this thesis
							</button>
						</div>
						<TagRow tag={t.tag} backed={backing !== null} />
						<div className="acts" style={{ marginTop: "12px" }}>
							<LikeButton likes={t.likes} liked={t.likedByViewer} />
							<span className="cnt">
								<CommentIcon />
								{t.commentCount}
							</span>
							<button type="button">
								<ShareIcon />
								share
							</button>
						</div>
					</div>
					{backing ? (
						<div className="board">
							<div>
								<span className="lbl">Pooled</span>
								<span className="v">{usd(backing.pooledUsd)}</span>
							</div>
							<div>
								<span className="lbl">Bull</span>
								<span className="v bull">{backing.bull.count}</span>
							</div>
							<div>
								<span className="lbl">Bear</span>
								<span className="v bear">{backing.bear.count}</span>
							</div>
							<div>
								<span className="lbl">Creator live</span>
								<span className="v bull">
									{signedUsd(backing.creatorLivePnlUsd)}
								</span>
							</div>
						</div>
					) : null}
				</header>

				{backing ? (
					<SplitBar
						bullLabel={`${backing.bull.pct}% Bull · ${backing.bull.amountLabel}`}
						bearLabel={`${backing.bear.pct}% Bear · ${backing.bear.amountLabel}`}
						bullPct={backing.bull.pct}
						barStyle={{ height: "14px", borderRadius: "7px" }}
					/>
				) : null}

				{backing && t.asset && detail.spotChangeLabel ? (
					<div className="charts">
						<div className="chartbox">
							<div className="hh">
								<span className="lbl">
									{t.asset} spot · 7d · entries pinned
								</span>
								<span className="v">
									{usd(detail.spotUsd)}{" "}
									<span className="bull" style={{ fontSize: "12px" }}>
										{detail.spotChangeLabel}
									</span>
								</span>
							</div>
							<SpotChart label="BTC spot price, 7 days, with participant entries marked" />
							<div className="legend">
								<span>
									<i style={{ background: "var(--tn-k)" }} />
									spot
								</span>
								<span>
									<i style={{ background: "var(--tn-bear)" }} />
									78,000 long put
								</span>
								<span>
									<i style={{ background: "var(--tn-dim)" }} />
									74,000 short put
								</span>
								<span>
									<i
										style={{
											background: "var(--tn-bull)",
											width: "8px",
											height: "8px",
											borderRadius: "50%",
										}}
									/>
									bull entry
								</span>
								<span>
									<i
										style={{
											background: "var(--tn-bear)",
											width: "8px",
											height: "8px",
											borderRadius: "50%",
										}}
									/>
									bear entry
								</span>
							</div>
						</div>
						<div className="chartbox">
							<div className="hh">
								<span className="lbl">Payoff at expiry · per $1,000</span>
								<span className="v">
									max{" "}
									<span className="bull">{signedUsd(detail.maxPayoutUsd)}</span>
								</span>
							</div>
							<PayoffChart label="Payoff diagram of the put spread at expiry" />
							<div className="legend">
								<span>
									<i style={{ background: "var(--tn-bull)" }} />
									Bull · long spread
								</span>
								<span>
									<i style={{ background: "var(--tn-bear)" }} />
									Bear · short spread
								</span>
								<span className="dim">
									break-even {usd(detail.breakEvenUsd)}
								</span>
							</div>
						</div>
					</div>
				) : null}

				{detail.participants.length > 0 ? (
					<ThesisTabs
						participantCount={detail.participantCount}
						commentCount={t.commentCount}
						participants={<ParticipantsTable rows={detail.participants} />}
						comments={<CommentsList comments={detail.comments} />}
					/>
				) : (
					<div className="sec">
						<div className="sec-h">
							<h2 className="h2">Replies</h2>
							<span className="mono dim" style={{ fontSize: "11px" }}>
								{t.commentCount}
							</span>
						</div>
						<CommentsList comments={detail.comments} />
					</div>
				)}
			</main>

			<aside className="col r">
				{/* A post carries no ticket. Trading happens on the market page. */}
				{t.tag ? (
					<div className="panel">
						<h3>Trade this</h3>
						<span className="note">
							{t.tag.structureLabel
								? `This post names the ${t.tag.asset} ${t.tag.structureLabel}.`
								: `This post is about the ${t.tag.asset} market.`}
						</span>
						<Link className="btn primary block" href={`/m/${t.tag.slug}`}>
							Trade this on the {t.tag.asset} market
						</Link>
						<span className="note">
							Bull buys the structure, Bear sells it. Both fills happen on the
							market page.
						</span>
					</div>
				) : (
					<div className="panel">
						<h3>Trade this</h3>
						<span className="note">
							This post names no market yet, so there is nothing to fill. Its
							author can tag one at any time.
						</span>
					</div>
				)}
				<SharePanel
					url={detail.shareUrl}
					headline={detail.shareHeadline}
					bull={backing?.bull}
					bear={backing?.bear}
				/>
			</aside>
		</div>
	);
}
