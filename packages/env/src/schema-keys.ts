/**
 * The set of environment variable names the validated schemas accept.
 *
 * Parsed from the schema SOURCE rather than imported, because importing
 * `./server` runs `createEnv` (and `./load`), which needs a real environment and
 * throws when one is missing. Two consumers share this:
 *
 *  - `packages/env/test/env-example.test.ts` — `.env.example` parity;
 *  - `scripts/sync-vercel-env.ts` — the allowlist of keys that may be pushed to
 *    Vercel. Everything else in an env file (the owner's `PROD_*`/`SUPABASE_*`
 *    keys, stray locals) is skipped there, so a secret that no deployed code
 *    reads can never be uploaded.
 *
 * Dev-time only: it imports the TypeScript compiler and reads files off disk.
 * Never import it from application code.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";

/** Property names inside the `server` / `client` / `shared` object literals. */
export function schemaKeys(source: string): string[] {
	const file = ts.createSourceFile("env.ts", source, ts.ScriptTarget.Latest, true);
	const keys: string[] = [];
	function visit(node: ts.Node): void {
		if (
			ts.isPropertyAssignment(node) &&
			["server", "client", "shared"].includes(node.name.getText(file)) &&
			ts.isObjectLiteralExpression(node.initializer)
		) {
			for (const property of node.initializer.properties) {
				if (!ts.isPropertyAssignment(property)) throw new Error("Unsupported env schema property");
				keys.push(property.name.getText(file).replace(/["']/g, ""));
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	return keys;
}

/** Both schemas' keys, read from this package's own sources. */
export function validatedEnvKeys(): string[] {
	return [
		...schemaKeys(readFileSync(new URL("./server.ts", import.meta.url), "utf8")),
		...schemaKeys(readFileSync(new URL("./web.ts", import.meta.url), "utf8")),
	];
}
