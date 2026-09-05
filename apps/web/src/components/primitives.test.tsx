import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar } from "./primitives";

test("a seeded person renders a local SVG image inside the avatar span", () => {
	const html = renderToStaticMarkup(<Avatar initials="MK" seed="wallet-a" size={40} />);
	expect(html).toMatch(/<span class="av av-40 a-mk"[^>]*><img[^>]*src="data:image\/svg\+xml/);
	expect(html).toContain('width="40" height="40"');
	expect(html).toContain('alt=""');
});
test("no seed keeps the original monogram markup byte-identical", () => {
	expect(renderToStaticMarkup(<Avatar initials="MK" />)).toBe('<span class="av av-34 a-mk" aria-hidden="true">MK</span>');
	expect(renderToStaticMarkup(<Avatar initials="MK" seed="" />)).toBe(renderToStaticMarkup(<Avatar initials="MK" />));
});
test("known assets render vendored logos and override person seeds", () => {
	const html = renderToStaticMarkup(<Avatar initials="BTC" asset="BTC" seed="wallet-a" size={30} />);
	expect(html).toContain('class="av av-30 av-asset"');
	expect(html).toContain('src="/asset-icons/btc.svg"');
	expect(html).not.toContain('data:image');
});
test("unknown assets and seed-only asset tone preserve monograms", () => {
	const html = '<span class="av av-34 av-asset" aria-hidden="true">FOO</span>';
	expect(renderToStaticMarkup(<Avatar initials="FOO" asset="FOO" seed="wallet-a" />)).toBe(html);
	expect(renderToStaticMarkup(<Avatar initials="FOO" tone="asset" seed="wallet-a" />)).toBe(html);
});

test("market pills render a 22px local asset logo", () => {
 const html = renderToStaticMarkup(<Avatar asset="BTC" tone="asset" initials="BTC" size={22} />);
 expect(html).toMatch(/<span class="av av-22 av-asset"[^>]*><img[^>]*src="\/asset-icons\/btc.svg"/);
 expect(html).toContain('width="22" height="22"');
});
