import { ProfileEditor } from "@/components/creator/profile-editor";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ActivityList } from "@/components/creator/activity-list";
import { CreatorStats } from "@/components/creator/creator-stats";
import { CalloutPost } from "@/components/feed/callout-post";
import { ParticipantsTable } from "@/components/thesis/participants-table";
import { creatorPageData } from "@/lib/page-data";

/**
 * Rendered per request, never from a build-time cache. Same reason as
 * `/t/[slug]`: in `DATA_SOURCE=db` a creator's profile changes after the build,
 * and segment config must be a static string, so it applies in mock mode too.
 */
export const dynamic = "force-dynamic";

/** Share metadata reads through the same mode-aware path as the page. */
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
	const { vercelOrigin } = await import("@nuts/env/server");
	const { handle } = await params;
	const data = await creatorPageData(handle.toLowerCase());
	if (!data) notFound();
	const title = data.creator.displayName;
	const description = data.creator.walletAddress ?? `@${data.creator.handle}`;
	return {
		...(vercelOrigin ? { metadataBase: new URL(vercelOrigin) } : {}),
		title,
		description,
		openGraph: { title, description, type: "profile" },
		twitter: { card: "summary_large_image", title, description },
	};
}

export default async function CreatorPage({
	params,
}: {
	params: Promise<{ handle: string }>;
}) {
	const { handle } = await params;
	// One canonical URL per creator. The handle is a lowercase wallet address
	// (lib/data/identity.ts) and `getCreator` lowercases before it queries, so
	// `/u/0xAB…` and `/u/0xab…` used to be two live URLs with identical content —
	// two cache entries and two share links for one profile. Redirect rather than
	// 404 so links that were already shared in mixed case keep working.
	if (handle !== handle.toLowerCase()) permanentRedirect(`/u/${handle.toLowerCase()}`);
	const data = await creatorPageData(handle);
	if (!data) notFound();
	const { creator, activity, callouts, positions } = data;

	return (
		<div className="work profile">
			<aside className="col l">
				<CreatorStats creator={creator} signedIn={data.signedIn} databaseMode={data.databaseMode} following={data.following} self={data.self} />
				{data.isOwner && data.editableProfile ? <ProfileEditor key={JSON.stringify(data.editableProfile)} profile={data.editableProfile} walletAddress={data.editableProfile.walletAddress} /> : null}
				<ActivityList items={activity} count={activity.length} />
			</aside>

			<main className="col">
				<div className="sec-h">
					<h2 className="h2">Callouts</h2>
				</div>
				<div className="feed">
					{callouts.map((t) => (
						<CalloutPost key={t.slug} thesis={t} signedIn={data.signedIn} databaseMode={data.databaseMode} />
					))}
				</div>
				<ParticipantsTable rows={positions} />
			</main>
		</div>
	);
}
