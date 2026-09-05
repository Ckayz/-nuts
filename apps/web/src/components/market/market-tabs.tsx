"use client";

import { useId, useState } from "react";
import { TabHeading, TabPanel } from "@/components/feed/tabs";
import { StructuresList } from "@/components/market/structures-list";
import { TaggedPostsTabs } from "@/components/market/tagged-posts-tabs";
import type { MarketStructure, Thesis } from "@/lib/display-types";

const LABELS = ["Structures", "Theses"] as const;

/**
 * The market page's bottom card: fomo puts a tabbed table under the chart
 * (`Trades | Thesis`, docs/design/FOMO-DIGEST.md, "Token page layout"). Ours are
 * the live book and the posts that name this market — the two lists that were
 * previously stacked as two separate cards.
 *
 * `Structures` is the default tab: it is the trading surface, and selecting a row
 * is still what loads the ticket AND what moves the chart's strike lines. That
 * selection is a LINK, not local state (`structures-list.tsx`), so it survives
 * this component entirely: the page reloads with `?structure=<id>`, the server
 * marks that row `selected`, and `app/m/[asset]/page.tsx` reads
 * `market.structures.find(row => row.selected)` for the chart exactly as before.
 * A fresh page render also puts this card back on the Structures tab, which is
 * where the row that was just chosen lives.
 *
 * Both panels stay mounted and the inactive one is hidden with the `hidden`
 * attribute rather than unmounted, so the Theses tab keeps its All/Backed filter
 * and any expanded post state while somebody reads the book.
 */
export function MarketTabs({
	rows,
	slug,
	query,
	live,
	posts,
	asset,
	signedIn = false,
	databaseMode = false,
}: {
	rows: MarketStructure[];
	slug?: string;
	/** Query values to keep when selecting another row, e.g. the post and side. */
	query?: Record<string, string>;
	/** C#6: whether THESE ROWS can navigate. Never "is there a ticket". */
	live?: boolean;
	posts: Thesis[];
	asset?: string;
	signedIn?: boolean;
	databaseMode?: boolean;
}) {
	const id = useId();
	const [tab, setTab] = useState(0);
	return (
		<section className="card tabcard">
			<div className="card-h tabs-h">
				<TabHeading
					id={id}
					labels={LABELS}
					selected={tab}
					onSelect={setTab}
					label={asset ? `${asset} book and theses` : "Book and theses"}
				/>
			</div>
			<TabPanel id={id} selected={tab}>
				<div hidden={tab !== 0}>
					<StructuresList rows={rows} slug={slug} query={query} live={live} />
				</div>
				<div hidden={tab !== 1}>
					<TaggedPostsTabs
						posts={posts}
						asset={asset}
						signedIn={signedIn}
						databaseMode={databaseMode}
					/>
				</div>
			</TabPanel>
		</section>
	);
}
