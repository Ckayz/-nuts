/**
 * `lib/display.ts` is imported by CLIENT components, so nothing it reaches may
 * pull a Node-only module into the browser bundle.
 *
 * D5 made `display.ts` import `position/pnl.ts` for `lifecycleStatus` and
 * `resolvePnl`. Every test stayed green and the db-mode production build broke:
 *   Module not found: Can't resolve 'fs/promises'
 *     … @thetanuts-finance/thetanuts-client/dist/index.mjs
 *     … apps/web/src/lib/position/pnl.ts   [Client Component SSR]
 *     … apps/web/src/lib/display.ts        [Client Component SSR]
 *     … apps/web/src/components/position/pnl-card.tsx [Client Component SSR]
 * A `next build` is the only check that sees it, and it costs minutes. This
 * walks the import graph in milliseconds instead.
 */
import { describe, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

/** Modules that must never appear in a browser bundle. */
const SERVER_ONLY = ["@nuts/thetanuts", "@thetanuts-finance/thetanuts-client", "@nuts/db", "server-only", "node:fs", "fs/promises"];

/**
 * The specifiers a file imports for their VALUES.
 *
 * `import type ... from` and `export type ... from` are erased by the compiler
 * and never reach a bundle, so counting them would flag `@/types` — which
 * re-exports a type from `position/instrument.ts` — and fail on code that is
 * perfectly safe. Measured: without this the guard reported `lifecycle.ts` as
 * an offender while the real `next build` passed.
 */
async function importsOf(file: string): Promise<string[]> {
	const source = await Bun.file(file).text();
	return [...source.matchAll(/^[ \t]*(?:import|export)(?!\s+type\s)[^"';]*?from\s+["']([^"']+)["']/gm)].map(
		(m) => m[1] ?? "",
	);
}

/** Resolves a specifier to a file inside `src`, or null when it leaves the app. */
async function resolveLocal(from: string, specifier: string): Promise<string | null> {
	const base = specifier.startsWith("@/")
		? join(ROOT, specifier.slice(2))
		: specifier.startsWith(".")
			? join(dirname(from), specifier)
			: null;
	if (base === null) return null;
	for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
		if (await Bun.file(candidate).exists()) return candidate;
	}
	return null;
}

async function graph(entry: string): Promise<{ files: string[]; offenders: Array<{ file: string; imports: string }> }> {
	const seen = new Set<string>();
	const offenders: Array<{ file: string; imports: string }> = [];
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);
		for (const specifier of await importsOf(file)) {
			if (SERVER_ONLY.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
				offenders.push({ file: file.slice(ROOT.length + 1), imports: specifier });
				continue;
			}
			const local = await resolveLocal(file, specifier);
			if (local !== null) queue.push(local);
		}
	}
	return { files: [...seen], offenders };
}

describe("client-safe modules pull in nothing server-only", () => {
	for (const entry of ["lib/display.ts", "lib/position/lifecycle.ts", "lib/trade/held-fill.ts", "lib/trade/approval.ts"]) {
		test(`${entry} and everything it imports`, async () => {
			const { files, offenders } = await graph(join(ROOT, entry));
			expect(files.length).toBeGreaterThanOrEqual(1);
			expect(offenders).toEqual([]);
		});
	}

	test("the guard actually catches one: position/pnl.ts IS server-only", async () => {
		// Proves the walker works. `pnl.ts` owns the risk model on purpose.
		const { offenders } = await graph(join(ROOT, "lib/position/pnl.ts"));
		expect(offenders.map((o) => o.imports)).toContain("@nuts/thetanuts");
	});
});
