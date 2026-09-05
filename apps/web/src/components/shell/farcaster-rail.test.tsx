import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FarcasterRail, initials } from "./farcaster-rail";
import type { FarcasterRailCast } from "@/lib/farcaster/casts";

const row: FarcasterRailCast = {
	hash: "0x029f7cce1234",
	username: "dwr.eth",
	displayName: "Dan Romero",
	avatarUrl: "https://example.invalid/pfp.png",
	text: "Basis on the Sep expiry finally looks sane again.",
	channelId: "base",
	url: "https://farcaster.xyz/dwr.eth/0x029f7cce",
};

test("the rail is labelled as somebody else's network, not this app's feed", () => {
	const html = renderToStaticMarkup(<FarcasterRail state={{ status: "ready", casts: [row] }} />);
	expect(html).toContain("From Farcaster");
	expect(html).toContain("Not Thesis.fun");
});

test("a ready cast draws handle, display name, avatar, text and an outbound link", () => {
	const html = renderToStaticMarkup(<FarcasterRail state={{ status: "ready", casts: [row] }} />);
	expect(html).toContain("Dan Romero");
	expect(html).toContain("@dwr.eth");
	expect(html).toContain('src="https://example.invalid/pfp.png"');
	// React 19 emits this attribute camel-cased in static markup; asserted as rendered.
	expect(html).toContain('referrerPolicy="no-referrer"');
	expect(html).toContain("Basis on the Sep expiry finally looks sane again.");
	expect(html).toContain('href="https://farcaster.xyz/dwr.eth/0x029f7cce"');
	expect(html).toContain('rel="noreferrer noopener"');
	expect(html).toContain("/base");
	// The established rail idiom, not a new one.
	expect(html).toContain('class="rail-post"');
	expect(html).toContain('class="card"');
});

test("no avatar falls back to the app's generated avatar rather than a broken image", () => {
	const html = renderToStaticMarkup(
		<FarcasterRail state={{ status: "ready", casts: [{ ...row, avatarUrl: null, displayName: null }] }} />,
	);
	expect(html).toContain("data:image/svg+xml");
	expect(html).not.toContain("example.invalid");
	// With no display name the handle is the name, and is still printed once as @handle.
	expect(html).toContain("@dwr.eth");
});

test("a cast with no permalink is drawn without a link, never with a dead one", () => {
	const html = renderToStaticMarkup(<FarcasterRail state={{ status: "ready", casts: [{ ...row, url: null }] }} />);
	expect(html).toContain('<div class="rail-post"');
	expect(html).not.toContain("<a ");
});

test("the unconfigured state says so and shows no cast and no skeleton", () => {
	const html = renderToStaticMarkup(<FarcasterRail state={{ status: "unconfigured" }} />);
	expect(html).toContain("not configured");
	expect(html).not.toContain("rail-post");
	expect(html).not.toContain("skeleton");
	expect(html).not.toContain("farcaster.xyz/");
});

test("the unavailable state is distinct from an empty one and invents nothing", () => {
	const unavailable = renderToStaticMarkup(
		<FarcasterRail state={{ status: "unavailable", detail: "Neynar returned HTTP 429." }} />,
	);
	const empty = renderToStaticMarkup(<FarcasterRail state={{ status: "ready", casts: [] }} />);
	expect(unavailable).toContain("could not be read");
	expect(unavailable).not.toBe(empty);
	expect(unavailable).not.toContain("rail-post");
	// The upstream detail is diagnostic, not visitor copy.
	expect(unavailable).not.toContain("429");
});

test("monograms come from the printed name", () => {
	expect(initials("Dan Romero")).toBe("DR");
	expect(initials("dwr.eth")).toBe("DW");
	expect(initials("   ")).toBe("?");
	expect(initials("a")).toBe("A");
});
