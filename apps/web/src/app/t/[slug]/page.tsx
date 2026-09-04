import { notFound } from "next/navigation";
import { ActivityList } from "@/components/creator/activity-list";
import { CreatorStats } from "@/components/creator/creator-stats";
import { SparkIcon } from "@/components/icons";
import { Avatar, Pill, SplitBar, StatusChip } from "@/components/primitives";
import { CommentsList } from "@/components/thesis/comments-list";
import { ParticipantsTable } from "@/components/thesis/participants-table";
import { PayoffChart } from "@/components/thesis/payoff-chart";
import { SharePanel } from "@/components/thesis/share-panel";
import { SpotChart } from "@/components/thesis/spot-chart";
import { TakeASide } from "@/components/thesis/take-a-side";
import { ThesisTabs } from "@/components/thesis/thesis-tabs";
import { signedUsd, usd } from "@/lib/format";
import { thesisDetails, thesisDetailBySlug } from "@/mock/data";

export function generateStaticParams() {
	return thesisDetails.map((d) => ({ slug: d.thesis.slug }));
}

export default async function ThesisPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const detail = thesisDetailBySlug(slug);
	if (!detail) notFound();
	const t = detail.thesis;

	return (
		<div className="work">
			<aside className="col l">
				<CreatorStats creator={t.creator} />
				<ActivityList items={detail.activity} count={detail.activityCount} />
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
							}}
						>
							<Pill on>{t.asset}</Pill>
							<Pill on>
								{t.structure.productType.charAt(0).toUpperCase()}
								{t.structure.productType.slice(1)}
							</Pill>
							<Pill>{t.structure.venueLabel}</Pill>
							<StatusChip
								status={t.status}
								label={t.statusLabel}
								style={{ marginLeft: "4px" }}
							/>
						</div>
						<h1 className="h">{t.headline}</h1>
						<div className="meta">
							<Avatar initials={t.creator.initials} size="s" />
							<b>{t.creator.displayName}</b>
							<span>{detail.launchedLabel}</span>
							<span>·</span>
							<span>
								expires <b className="mono">{detail.expiryLabel}</b>
							</span>
							<span>·</span>
							<span>{detail.settlementLabel}</span>
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
					</div>
					<div className="board">
						<div>
							<span className="lbl">Pooled</span>
							<span className="v">{usd(t.pooledUsd)}</span>
						</div>
						<div>
							<span className="lbl">Bull</span>
							<span className="v bull">{t.bull.count}</span>
						</div>
						<div>
							<span className="lbl">Bear</span>
							<span className="v bear">{t.bear.count}</span>
						</div>
						<div>
							<span className="lbl">Creator live</span>
							<span className="v bull">{signedUsd(t.creatorLivePnlUsd)}</span>
						</div>
					</div>
				</header>

				<SplitBar
					bullLabel={`${t.bull.pct}% Bull · ${t.bull.amountLabel}`}
					bearLabel={`${t.bear.pct}% Bear · ${t.bear.amountLabel}`}
					bullPct={t.bull.pct}
					barStyle={{ height: "14px", borderRadius: "7px" }}
				/>

				<div className="charts">
					<div className="chartbox">
						<div className="hh">
							<span className="lbl">{t.asset} spot · 7d · entries pinned</span>
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
								max <span className="bull">{signedUsd(detail.maxPayoutUsd)}</span>
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
							<span className="dim">break-even {usd(detail.breakEvenUsd)}</span>
						</div>
					</div>
				</div>

				<ThesisTabs
					participantCount={detail.participantCount}
					commentCount={t.commentCount}
					participants={<ParticipantsTable rows={detail.participants} />}
					comments={<CommentsList comments={detail.comments} />}
				/>
			</main>

			<aside className="col r">
				<TakeASide ticket={detail.ticket} />
				<SharePanel
					url={detail.shareUrl}
					headline={detail.shareHeadline}
					bull={t.bull}
					bear={t.bear}
				/>
			</aside>
		</div>
	);
}
