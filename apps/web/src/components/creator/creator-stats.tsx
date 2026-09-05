import { Avatar } from "@/components/primitives";
import { pnlClass, signedUsd } from "@/lib/format";
import type { Creator } from "@/lib/display-types";

export function CreatorStats({ creator }: { creator: Creator }) {
	return (
		<div className="sec">
			<div className="sec-h">
				<span className="lbl">Creator</span>
				<button type="button" className="btn sm">
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
						<dd>{creator.followers}</dd>
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
