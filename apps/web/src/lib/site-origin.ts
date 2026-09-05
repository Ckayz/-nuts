import "server-only";
import { headers } from "next/headers";
import { vercelOrigin } from "@nuts/env/server";

/**
 * Every origin this deployment legitimately answers on, for matching `/p/<uuid>`
 * links inside a post's text.
 *
 * 9(b). This used to return ONE origin, preferring `vercelOrigin`
 * (`VERCEL_URL`). On Vercel that is the per-deployment URL, so a visitor reading
 * the site on a custom domain or a branch alias — and `CopyLink` builds the
 * copied address from the browser's own `window.location.origin` — copied a link
 * the server then refused to recognise, and the trade card never unfurled.
 *
 * Both are accepted now: the deployment URL AND the origin this request actually
 * arrived on. They are matched, never used to BUILD a link, so accepting a
 * second one cannot widen anything an attacker controls beyond what the Host
 * header already decided — and `tradeLinkTarget` still rebuilds every href as a
 * bare `/p/<uuid>` path.
 *
 * The list is ordered deployment-URL first and de-duplicated; on a local run
 * where `VERCEL_URL` is unset it is just the request's own origin.
 */
export async function siteOrigins(): Promise<string[]> {
	const origins: string[] = [];
	const add = (value: string | undefined) => {
		if (value === undefined) return;
		try {
			const origin = new URL(value).origin;
			if (!origins.includes(origin)) origins.push(origin);
		} catch { /* an unusable value is simply not an accepted origin */ }
	};

	add(vercelOrigin);

	// A request origin is only available while rendering a request. If this is
	// ever called outside one, the deployment URL alone is still correct — a
	// throw here would take down a page over a link-matching detail.
	try {
		const request = await headers();
		const host = request.get("host");
		if (host !== null && host !== "") {
			add(`${request.get("x-forwarded-proto") === "https" ? "https" : "http"}://${host}`);
		}
	} catch { /* no request context */ }

	return origins;
}
