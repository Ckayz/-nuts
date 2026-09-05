import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PositionPage } from "@/components/position/position-page";
import { positionPageData } from "@/lib/page-data";

/**
 * One position's own page (owner 2026-09-05: "trade is just trade. post(thesis)
 * is it's own thing"). A `/p/<uuid>` link dropped into a post unfurls back into
 * the same card, the way X renders a link to one of its own posts.
 *
 * Rendered per request, for the same reason `/t/[slug]` is (see the note at the
 * end of `src/lib/page-data.ts`): a position's status and P&L change after the
 * build — pending becomes confirmed, confirmed becomes settled — and a cached
 * page would keep showing the state it was built in. A `revalidate` interval
 * would be an owner's number and is deliberately not used.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const page = await positionPageData((await params).id);
	if (!page) notFound();
	const title = `${page.card.sideLabel} · ${page.card.instrumentLabel}`;
	const description = `${page.card.pnlLabel} ${page.card.pnl.signed2} · ${page.card.statusLabel}`;
	return {
		title,
		description,
		openGraph: { title, description, type: "article" },
		twitter: { card: "summary_large_image", title, description },
	};
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
	const page = await positionPageData((await params).id);
	if (!page) notFound();
	return <PositionPage page={page} />;
}
