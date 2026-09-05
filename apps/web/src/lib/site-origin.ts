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
 *
 * M1 (user-flow re-walk 2026-09-06, mechanism re-measured — the tester's own
 * reading of it was WRONG and is corrected here). `headers()` does NOT throw in
 * the render that follows a publish action; it returns headers whose `host` is
 * the SERVER's own address, not the browser's. Measured on `next start`, one
 * publish from `http://127.0.0.1:3171/new`:
 *
 *   normal page render      host=127.0.0.1:3171  x-forwarded-host=127.0.0.1:3171
 *   post-action re-render   host=localhost:3171  x-forwarded-host=127.0.0.1:3171
 *                           (x-action-redirect=/t/<slug>;push)
 *
 * So the accepted list held `http://localhost:3171` while `CopyLink` had copied
 * `http://127.0.0.1:3171/p/<uuid>`, the absolute link failed the same-origin
 * test, and the post rendered a bare URL until a plain GET re-rendered it. The
 * forwarded host is the PUBLIC one every proxy (Next's own redirect fetch here,
 * and Vercel's edge in front of a custom domain) puts there, so it is read as
 * well as `host`. Both are equally client-supplied through the proxy chain, and
 * neither widens anything: an origin is only ever MATCHED and stripped, and
 * `lib/thesis/links.ts` `tradeLinkTarget` rebuilds every href as a bare
 * `/p/<uuid>` path.
 */
export interface RequestOriginHeaders {
	/** `VERCEL_URL`, or undefined off Vercel. */
	readonly deploymentUrl?: string | undefined;
	readonly forwardedHost?: string | null | undefined;
	readonly host?: string | null | undefined;
	readonly forwardedProto?: string | null | undefined;
}

/**
 * The pure half, so the header rules are unit-testable without mocking
 * `next/headers` (a `mock.module` call is global to the whole `bun test`
 * process — see the note in `lib/thesis-context.test.ts`).
 */
export function acceptedOrigins(input: RequestOriginHeaders): string[] {
	const origins: string[] = [];
	const add = (value: string | undefined) => {
		if (value === undefined) return;
		try {
			const origin = new URL(value).origin;
			if (!origins.includes(origin)) origins.push(origin);
		} catch { /* an unusable value is simply not an accepted origin */ }
	};

	add(input.deploymentUrl);

	const scheme = input.forwardedProto === "https" ? "https" : "http";
	// The forwarded host FIRST: it is the address the browser typed, and it is
	// the only one that survives Next's own post-action re-render.
	for (const value of [input.forwardedHost, input.host]) {
		// A comma-joined list means several proxies appended; the first entry is
		// the client-facing one. Anything that is not a host (a slash, a space, an
		// `@`) is dropped by `add`'s URL parse rather than repaired.
		const host = value === null || value === undefined ? undefined : value.split(",")[0]?.trim();
		if (host !== undefined && host !== "") add(`${scheme}://${host}`);
	}

	return origins;
}

export async function siteOrigins(): Promise<string[]> {
	// A request origin is only available while rendering a request. If this is
	// ever called outside one, the deployment URL alone is still correct — a
	// throw here would take down a page over a link-matching detail.
	try {
		const request = await headers();
		return acceptedOrigins({
			deploymentUrl: vercelOrigin,
			forwardedHost: request.get("x-forwarded-host"),
			host: request.get("host"),
			forwardedProto: request.get("x-forwarded-proto"),
		});
	} catch {
		return acceptedOrigins({ deploymentUrl: vercelOrigin });
	}
}
