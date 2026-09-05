import { notFound } from "next/navigation";
import { ActivityList } from "@/components/creator/activity-list";
import { CreatorStats } from "@/components/creator/creator-stats";
import { CalloutPost } from "@/components/feed/callout-post";
import { ParticipantsTable } from "@/components/thesis/participants-table";
import { creatorPageData, staticCreatorHandles } from "@/lib/page-data";

export function generateStaticParams() {
	return staticCreatorHandles();
}

export default async function CreatorPage({
	params,
}: {
	params: Promise<{ handle: string }>;
}) {
	const { handle } = await params;
	const data = await creatorPageData(handle);
	if (!data) notFound();
	const { creator, activity, callouts, positions } = data;

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
