import { expect, test } from "bun:test";

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
