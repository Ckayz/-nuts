import { expect, test } from "bun:test";

import { acceptedOrigins } from "./site-origin";
import { extractTradeLinks } from "./thesis/links";

/**
 * 9(b). `siteOrigins()` reads `next/headers` and `@nuts/env/server`, so each
 * case runs in its own child with those two modules stubbed — the same
 * `bun plugin` + subprocess shape `social.test.ts` uses for `next/headers`.
 */
function run(vercelOrigin: string | undefined, headerLines: Record<string, string> | "throws"): string[] {
	const script = `
		import { plugin } from "bun";
		plugin({ name: "site-origin-probe", setup(build) {
			build.module("server-only", () => ({ exports: {}, loader: "object" }));
			build.module("@nuts/env/server", () => ({ exports: { vercelOrigin: ${JSON.stringify(vercelOrigin)} }, loader: "object" }));
			build.module("next/headers", () => ({ exports: { headers: async () => {
				${headerLines === "throws"
					? 'throw new Error("headers() outside a request scope");'
					: `const map = new Map(Object.entries(${JSON.stringify(headerLines)}));
				       return { get: (key) => map.get(key) ?? null };`}
			} }, loader: "object" }));
		}});
		const { siteOrigins } = await import("./src/lib/site-origin.ts");
		console.log("RESULT:" + JSON.stringify(await siteOrigins()));
	`;
	const child = Bun.spawnSync([process.execPath, "-e", script], {
		cwd: new URL("../..", import.meta.url).pathname,
		env: { ...process.env, DATABASE_URL: "", SKIP_ENV_VALIDATION: "1" },
		stdout: "pipe", stderr: "pipe",
	});
	if (child.exitCode !== 0) throw new Error(child.stderr.toString());
	const line = child.stdout.toString().split("\n").find(part => part.startsWith("RESULT:"));
	if (line === undefined) throw new Error(`no result: ${child.stdout.toString()}`);
	return JSON.parse(line.slice("RESULT:".length));
}

const PREVIEW = "https://thesis-fun-abc123.vercel.app";

test("a link copied on the custom domain is accepted on a preview deployment, and vice versa", () => {
	// The whole point of 9(b): VERCEL_URL is the per-deployment name, the visitor
	// is on the custom domain, so BOTH must be accepted.
	expect(run(PREVIEW, { host: "thesis.fun", "x-forwarded-proto": "https" }))
		.toEqual([PREVIEW, "https://thesis.fun"]);
});

test("the request origin alone is used when the deployment has no URL of its own", () => {
	expect(run(undefined, { host: "localhost:3001" })).toEqual(["http://localhost:3001"]);
});

test("the same origin under both names is listed once", () => {
	expect(run("https://thesis.fun", { host: "thesis.fun", "x-forwarded-proto": "https" }))
		.toEqual(["https://thesis.fun"]);
	expect(run("https://thesis.fun/", { host: "thesis.fun", "x-forwarded-proto": "https" }))
		.toEqual(["https://thesis.fun"]);
});

test("http is only assumed when the proxy did not say https", () => {
	expect(run(undefined, { host: "thesis.fun", "x-forwarded-proto": "https" })).toEqual(["https://thesis.fun"]);
	expect(run(undefined, { host: "thesis.fun", "x-forwarded-proto": "http" })).toEqual(["http://thesis.fun"]);
	expect(run(undefined, { host: "thesis.fun" })).toEqual(["http://thesis.fun"]);
});

test("an unusable VERCEL_URL is dropped instead of poisoning the list", () => {
	expect(run("not a url", { host: "thesis.fun", "x-forwarded-proto": "https" })).toEqual(["https://thesis.fun"]);
});

test("no request context still yields the deployment origin, and never throws", () => {
	expect(run(PREVIEW, "throws")).toEqual([PREVIEW]);
});

test("nothing to go on returns nothing rather than failing the page", () => {
	// The single-origin version threw "Request has no Host header" here, which
	// would take a page down over a link-matching detail. An empty list simply
	// means only path-only `/p/<uuid>` links unfurl.
	expect(run(undefined, "throws")).toEqual([]);
	expect(run(undefined, {})).toEqual([]);
});

/**
 * M1 (user-flow re-walk 2026-09-06). The tester's own reading of this defect was
 * WRONG — `headers()` does not throw in the render that follows a publish
 * action. Re-measured on a `next start` production build, publishing from
 * `http://127.0.0.1:3171/new`:
 *
 *   normal page render      host=127.0.0.1:3171  x-forwarded-host=127.0.0.1:3171
 *   post-action re-render   host=localhost:3171  x-forwarded-host=127.0.0.1:3171
 *                           (x-action-redirect=/t/<slug>;push)
 *
 * The re-render's `host` is the SERVER's own address, so the copied absolute
 * URL failed the same-origin test and the post rendered a bare URL until it was
 * reloaded. The forwarded host is the one the browser actually used.
 */
test("the post-action re-render's forwarded host is accepted, not just the server's own host", () => {
	expect(
		run(undefined, {
			host: "localhost:3171",
			"x-forwarded-host": "127.0.0.1:3171",
			"x-forwarded-proto": "http",
		}),
	).toEqual(["http://127.0.0.1:3171", "http://localhost:3171"]);
});

test("a custom domain in front of a deployment URL is accepted from the forwarded host", () => {
	expect(
		run(PREVIEW, {
			host: "thesis-fun-abc123.vercel.app",
			"x-forwarded-host": "thesis.fun",
			"x-forwarded-proto": "https",
		}),
	).toEqual([PREVIEW, "https://thesis.fun"]);
});

test("a proxy chain uses the client-facing first entry", () => {
	expect(
		run(undefined, {
			host: "internal.local",
			"x-forwarded-host": "thesis.fun, internal.local",
			"x-forwarded-proto": "https",
		}),
	).toEqual(["https://thesis.fun", "https://internal.local"]);
});

test("an unusable forwarded host is dropped, never repaired", () => {
	expect(
		run(undefined, { host: "thesis.fun", "x-forwarded-host": "not a host", "x-forwarded-proto": "https" }),
	).toEqual(["https://thesis.fun"]);
	expect(run(undefined, { "x-forwarded-host": "   ", host: "" })).toEqual([]);
});

/**
 * The end the user sees: with the post-action re-render's origins, the copied
 * absolute URL unfurls, and a look-alike host still does not.
 */
test("the copied absolute URL unfurls with the post-action origins", () => {
	const origins = acceptedOrigins({
		host: "localhost:3171",
		forwardedHost: "127.0.0.1:3171",
		forwardedProto: "http",
	});
	const id = "69125d9b-38e3-4280-9119-61ee46fefff4";
	expect(extractTradeLinks(`See http://127.0.0.1:3171/p/${id} now`, origins)).toEqual([id]);
	expect(extractTradeLinks(`See http://127.0.0.1:3171.evil.example/p/${id} now`, origins)).toEqual([]);
});
