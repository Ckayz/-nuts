import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CommentForm } from "./comment-form";
import { CommentsList } from "./comments-list";
import { Composer } from "@/app/new/composer";
import { PositionRows } from "./position-rows";
import { amount, creator } from "@/lib/display";
import { currentUser } from "@/mock/data";

const viewerSeed = "0xabcdef";
const noop = () => {};

test("comment form renders the viewer image at 34px", () => {
 const html = renderToStaticMarkup(<CommentForm thesisId="test" signedIn databaseMode viewerSeed={viewerSeed} initials="AB" onMockComment={noop} onPending={noop} />);
 expect(html).toMatch(/<span class="av av-34 [^"]*"[^>]*><img[^>]*src="data:image\/svg\+xml/);
});

test("signed-out comment list ignores viewer identity and renders question mark", () => {
 const html = renderToStaticMarkup(<CommentsList comments={[]} thesisId="test" databaseMode signedIn={false} viewerSeed={viewerSeed} viewerInitials="AB" />);
 expect(html).toMatch(/<span class="av av-34 [^"]*"[^>]*>\?<\/span>/);
 expect(html).not.toContain("data:image");
});

test("composer renders the viewer image and market logo", () => {
 const html = renderToStaticMarkup(<Composer assets={[{ asset: "BTC", name: "BTC" }]} presetAsset={null} presetRationale="" previewCards={[]} signedIn databaseMode viewerSeed={viewerSeed} viewerInitials="AB" />);
 expect(html).toMatch(/<span class="av av-40 [^"]* compose-avatar"[^>]*><img[^>]*src="data:image\/svg\+xml/);
 expect(html).toMatch(/<span class="av av-22 av-asset"[^>]*><img[^>]*src="\/asset-icons\/btc.svg"/);
});

test("signed-out composer renders question mark without viewer image", () => {
 const html = renderToStaticMarkup(<Composer assets={[]} presetAsset={null} presetRationale="" previewCards={[]} signedIn={false} databaseMode viewerSeed={viewerSeed} viewerInitials="AB" />);
 expect(html).toMatch(/<span class="av av-40 [^"]* compose-avatar"[^>]*>\?<\/span>/);
 expect(html).not.toContain("data:image");
});

test("participant row has a single 34px person avatar", () => {
 const html = renderToStaticMarkup(<PositionRows rows={[{ creator: creator(currentUser), side: "bull", riskedUsd: amount("1"), livePnlUsd: amount("0"), says: "" }]} />);
 expect(html.match(/class="av /g)).toHaveLength(1);
 expect(html).toMatch(/<span class="av av-34 [^"]*"[^>]*><img/);
});
