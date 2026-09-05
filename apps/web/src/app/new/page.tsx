import { Composer } from "./composer";
import { composerData } from "@/lib/thesis/composer-data";

/**
 * The composer. Round 6 (owner 2026-09-05, "a pure text opinion is fine also"):
 * a post is text first. Naming a market is optional, naming a structure inside
 * that market is optional, and backing it with your own fill happens on the
 * market page afterwards — so there is no ticket here.
 *
 * Two URL parameters, both validated before use (Next 16 docs,
 * `01-app/03-api-reference/03-file-conventions/page.md`: `searchParams` is a
 * Promise and reading it makes the route dynamic — the route table below moves
 * from ○ to ƒ because of this):
 *   ?asset=BTC          preselects the market tag;
 *   ?link=/p/<uuid>     preselects the rationale with a link to that position,
 *                       so the flow the owner described — place a trade, copy
 *                       its link, write the post — arrives with the trade card
 *                       already showing in the preview.
 *
 * The mockup has no composer copy beyond the rail button's title "Launch a
 * thesis" (docs/mockups/thesis-fun-mockup.html). Labels are the minimum needed
 * to name the controls; the real copy is the owner's.
 */
export default async function NewThesisPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const data = await composerData(await searchParams);
	return (
		<div className="work single">
			<main className="col">
				<Composer {...data} />
			</main>
		</div>
	);
}
