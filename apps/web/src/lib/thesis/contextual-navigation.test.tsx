import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TagRow } from "@/components/primitives";
import { CalloutPost } from "@/components/feed/callout-post";
import { CreatorStats } from "@/components/creator/creator-stats";
import { theses } from "../view-data";
import { toPosts } from "../page-data";
import { theses as domainPosts } from "@/mock/data";

test("contextual chips carry the exact thesis query, and Explain is a link", () => {
	const post = theses.find(post => post.tag !== null)!;
	const html = renderToStaticMarkup(<TagRow tag={post.tag} thesisId={post.id} />);
	expect(html).toContain(`/m/${post.tag!.slug}?thesis=${post.id}`);
	const rendered = renderToStaticMarkup(<CalloutPost thesis={post} />);
	expect(rendered).toContain(`href="/agent?thesis=${post.id}"`);
	expect(rendered).toContain("Share");
});
test("own creator card omits Follow", () => {
	const html = renderToStaticMarkup(<CreatorStats creator={theses[0]!.creator} self signedIn databaseMode />);
	expect(html).not.toContain(">Follow</button>");
});
test("shared post converter used by the market retains backing cards", async () => {
	const backed = domainPosts.find(post => post.backing !== null)!;
	const [view] = await toPosts([backed]);
	expect(view?.backingCard).not.toBeNull();
	expect(view?.backingCard).toBeDefined();
});
