import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActivityList } from "@/components/creator/activity-list";
import { CreatorStats } from "@/components/creator/creator-stats";
import { CalloutPost } from "@/components/feed/callout-post";
import { ParticipantsTable } from "@/components/thesis/participants-table";
import {
	activityByCreator,
	allCreators,
	creatorByHandle,
	participantsByCreator,
	thesesByCreator,
} from "@/lib/view-data";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const creator = creatorByHandle((await params).handle);
  if (!creator) notFound();
  const title = creator.displayName;
  const description = creator.handle ? `@${creator.handle}` : creator.walletAddress ?? creator.displayName;
  return { title, description, openGraph: { title, description, type: "profile" }, twitter: { card: "summary_large_image", title, description } };
}

export function generateStaticParams() {
	return allCreators.map((c) => ({ handle: c.handle }));
}

export default async function CreatorPage({
	params,
}: {
	params: Promise<{ handle: string }>;
}) {
	const { handle } = await params;
	const creator = creatorByHandle(handle);
	if (!creator) notFound();

	const activity = activityByCreator(handle);
	const callouts = thesesByCreator(handle);
	const positions = participantsByCreator(handle);

	return (
		<div className="work profile">
			<aside className="col l">
				<CreatorStats creator={creator} />
				<ActivityList items={activity} count={activity.length} />
			</aside>

			<main className="col">
				<div className="sec-h">
					<h2 className="h2">Callouts</h2>
				</div>
				<div className="feed">
					{callouts.map((t) => (
						<CalloutPost key={t.slug} thesis={t} />
					))}
				</div>
				<ParticipantsTable rows={positions} />
			</main>
		</div>
	);
}
