/**
 * Test preload. `server-only` resolves to a module that throws unless the
 * `react-server` export condition is set (verified: server-only@0.0.1
 * index.js throws; exports map sends `react-server` to empty.js). Next sets
 * that condition; `bun test` does not, so the marker is stubbed here instead
 * of removing it from the server modules it guards.
 */
import { plugin } from "bun";

plugin({
	name: "server-only-stub",
	setup(build) {
		build.module("server-only", () => ({ exports: {}, loader: "object" }));
	},
});
