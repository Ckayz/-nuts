import Link from "next/link";

import { TodoOwner } from "@/components/primitives";

/**
 * m9 (user-flow re-walk 2026-09-06). `/p/<unknown-uuid>`, `/t/no-such-slug`,
 * `/u/nosuchhandle` and `/m/zzz` all correctly return HTTP 404, but the body
 * was the bare framework default ("404 / This page could not be found.") with
 * no way back into the app.
 *
 * This file is rendered INSIDE `app/layout.tsx`, so the top bar, the nav and
 * the footer are already there and the page only supplies the card. The way
 * back is the nav's own word for the home route, so no new destination and no
 * new label is invented.
 *
 * The mockup has NO 404 view (docs/mockups/README.md lists seven views: feed,
 * market, position, the post-fill dialog, thread, profile, composer). The one
 * sentence below is therefore provisional and carries a TODO-OWNER chip, like
 * every other unapproved sentence in the product.
 */
export default function NotFound() {
	return (
		<section className="card pad" style={{ padding: 26 }}>
			<h1>Page not found</h1>
			<p className="mut">
				This page does not exist, or it was never published. <TodoOwner />
			</p>
			<p>
				<Link className="btn acc" href="/">
					Feed
				</Link>
			</p>
		</section>
	);
}
