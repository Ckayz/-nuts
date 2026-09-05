import { expect, test } from "bun:test";
import { readMarketSummaries } from "./summaries";
import { marketSummaries } from "../view-data";

test("production market selection uses a live set different from fixtures", async () => {
	const result = await readMarketSummaries(true, async () => ({
		assets: [{ asset: "PAXG", slug: "paxg", spotUsd: 3500, structures: [] }], fetchedAt: new Date(0),
	}), async () => { throw new Error("production read fixtures"); });
	expect(result.markets.map(row => row.asset)).toEqual(["PAXG"]);
	expect(result.markets.map(row => row.asset)).not.toEqual(marketSummaries.map(row => row.asset));
	expect(result.markets[0]?.spotUsd.usd2).toBe("$3,500.00");
	expect(result.markets[0]?.changeLabel).toBe("");
});
test("book rejection yields unavailable, never fixtures", async () => {
	expect(await readMarketSummaries(true, async () => { throw new Error("offline"); }, async () => marketSummaries)).toEqual({ markets: [], unavailable: true });
});
test("mock selection retains fixtures without a live read", async () => {
	expect(await readMarketSummaries(false, async () => { throw new Error("mock read network"); }, async () => marketSummaries)).toEqual({ markets: marketSummaries, unavailable: false });
});

test("NODE_ENV=production DATA_SOURCE=db routes the shared boundary to the live book", () => {
	const script = `
		import { plugin } from "bun";
		globalThis.fetch = async () => { throw new Error("unexpected network"); };
		plugin({ name: "production-market-source", setup(build) {
			build.module("next/server", () => ({ loader: "object", exports: { connection: async () => {} } }));
			build.module("@/lib/market/live", () => ({ loader: "object", exports: { getLiveMarkets: async () => ({ assets: [{ asset: "PAXG", slug: "paxg", spotUsd: 3500, structures: [] }], fetchedAt: new Date(0) }) } }));
		}});
		const { marketSummariesData } = await import("./src/lib/market/summaries.ts");
		console.log(JSON.stringify(await marketSummariesData()));
	`;
	const child = Bun.spawnSync([process.execPath, "--preload", "./test/setup.ts", "-e", script], {
		cwd: new URL("../../..", import.meta.url).pathname,
		// A fully valid production env: A-C5 made SKIP_ENV_VALIDATION inert in
		// production, so the case has to satisfy the schema to reach the code it
		// is about. The URL is a loopback fixture that is never connected to —
		// `@/lib/market/live` is stubbed above and `fetch` throws.
		env: {
			...process.env,
			NODE_ENV: "production",
			DATA_SOURCE: "db",
			DATABASE_URL: "postgresql://user:pw@127.0.0.1:5432/fixture",
			SESSION_SECRET: "x".repeat(32),
			SKIP_ENV_VALIDATION: "1",
		}, stdout: "pipe", stderr: "pipe",
	});
	expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({ code: 0, stderr: "" });
	const result = JSON.parse(child.stdout.toString());
	expect(result.unavailable).toBe(false);
	expect(result.markets.map((row: { asset: string }) => row.asset)).toEqual(["PAXG"]);
});
