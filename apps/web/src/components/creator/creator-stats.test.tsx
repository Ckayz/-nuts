/**
 * Owner decision 6 (2026-09-06): the profile bio is RENDERED.
 *
 * The bug this pins is that `users.bio` was collected by the profile editor and
 * displayed nowhere — fold-final-D §5 measured it and stopped for the owner's
 * call. The assertions are on a real render of the header, not on the source.
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CreatorStats } from "./creator-stats";
import type { Creator } from "@/lib/display-types";

const creator: Creator = {
	handle: "merkle_mike",
	handleLabel: "merkle_mike",
	displayName: "merkle_mike",
	initials: "MK",
	avatarSeed: "0x7c4a",
	walletAddress: "0x7c4a…e10b",
	sinceLabel: "since Jun 26",
};

const BIO = "Selling weekend vol since 2019. Base only, and every fill is on chain.";

function header(bio: string | null) {
	return renderToStaticMarkup(<CreatorStats creator={creator} bio={bio} profile />);
}

test("the stored bio is in the profile header, under the name and handle", () => {
	const html = header(BIO);
	expect(html).toContain(BIO);
	// Under the name and handle, above the address line — the order the decision
	// names. Indices, so a rearrangement that still contains the text fails.
	const name = html.indexOf("<h1>merkle_mike</h1>");
	const handle = html.indexOf('class="handle"');
	const bio = html.indexOf(BIO);
	const address = html.indexOf("0x7c4a…e10b");
	expect(name).toBeGreaterThanOrEqual(0);
	expect(bio).toBeGreaterThan(handle);
	expect(handle).toBeGreaterThan(name);
	expect(address).toBeGreaterThan(bio);
	// The existing muted text, no new styling: the same `.meta` class the
	// address line carries.
	expect(html).toContain(`<p class="meta bio">${BIO}</p>`);
});

test("no bio, an empty bio and a whitespace-only bio render nothing at all", () => {
	const none = header(null);
	expect(none).not.toContain('class="meta bio"');
	expect(header("")).not.toContain('class="meta bio"');
	expect(header("   \n\t ")).not.toContain('class="meta bio"');
	// Guard: the header itself still rendered, so the case above cannot pass
	// because nothing was drawn.
	expect(none).toContain("<h1>merkle_mike</h1>");
});

test("a bio is escaped, never interpolated as markup", () => {
	expect(header('<img src=x onerror="alert(1)">')).toContain("&lt;img src=x onerror=");
});

test("the compact and card forms are unchanged: the decision names /u/<handle> only", () => {
	expect(renderToStaticMarkup(<CreatorStats creator={creator} bio={BIO} compact />)).not.toContain(BIO);
	expect(renderToStaticMarkup(<CreatorStats creator={creator} bio={BIO} />)).not.toContain(BIO);
});
