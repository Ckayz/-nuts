/**
 * F-E item 4. The scope gate's retry RULE, kept in its own module.
 *
 * Two reasons it is not in `scope.ts`:
 *  - it can then be tested without a provider, by injecting the two calls;
 *  - `request.test.ts` replaces `@/lib/agent/scope` wholesale with `mock.module`,
 *    which is PROCESS-WIDE in bun, so anything exported from `scope.ts` vanishes
 *    for every other test file in the run. Measured: the first version of this
 *    function lived there and the whole suite died with
 *    `SyntaxError: Export named 'withJsonShapeFallback' not found in module …/scope.ts`.
 */
import { NoObjectGeneratedError } from "ai";

/**
 * Try `strict`; if — and ONLY if — it came back UNPARSEABLE, try `loose` once.
 *
 * Anything else (a 402, a 429, a model the provider does not serve) would fail
 * identically the second time and cost twice as much, so it is rethrown for the
 * error classifier to name.
 *
 * `NoObjectGeneratedError.isInstance` is the SDK's own check (`ai@7.0.92`
 * exports the class), so a renamed error string cannot quietly widen this.
 */
export async function withJsonShapeFallback<T>(
	strict: () => Promise<T>,
	loose: () => Promise<T>,
	onFallback: () => void = () => {},
): Promise<T> {
	try {
		return await strict();
	} catch (error) {
		if (!NoObjectGeneratedError.isInstance(error)) throw error;
		onFallback();
		return await loose();
	}
}
