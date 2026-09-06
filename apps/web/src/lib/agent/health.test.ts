/**
 * F-E item 2. `/api/agent/health`.
 *
 * The probe is injected as a PARAMETER, never mocked: `mock.module` is
 * process-wide in bun (measured by lane C, recorded in `request.test.ts`), so a
 * mocked provider here would follow every other file in the run.
 *
 * Zero model calls happen in this file.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { AgentErrorClass } from "./errors";
import {
	PROBE_CACHE_MS,
	PROBE_TOKEN_HEADER,
	PROBE_TOKEN_MIN_LENGTH,
	type ProbeCaller,
	agentHealth,
	resetProbeCache,
} from "./health";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const AGENT = { variable: "AGENT_MODEL", id: "anthropic/claude-haiku-4.5" } as const;
const GATE = { variable: "AGENT_GATE_MODEL", id: "anthropic/claude-haiku-4.5" } as const;
/** A fixture operator token, 32 characters. Never a real value. */
const OPERATOR_TOKEN = "operator-fixture-token-0123456789";
/** Every probing case in this file is an AUTHORISED one unless it says otherwise. */
const AUTHORISED = { configured: OPERATOR_TOKEN, presented: OPERATOR_TOKEN } as const;

/** Counts calls so "did not call the provider" is a measured fact, not a hope. */
function counting(behaviour: (role: "agent" | "gate") => void = () => {}): {
	caller: ProbeCaller;
	calls: string[];
} {
	const calls: string[] = [];
	const caller: ProbeCaller = async (model) => {
		calls.push(`${model.role}:${model.id}`);
		behaviour(model.role);
	};
	return { caller, calls };
}

beforeEach(() => resetProbeCache());

describe("the plain GET costs nothing", () => {
	test("owner ruling 03:4x — no model is called without ?probe=1", async () => {
		const { caller, calls } = counting();
		const { status, body } = await agentHealth({
			usingGateway: true,
			agent: AGENT,
			gate: GATE,
			probe: false,
			probeCaller: caller,
			now: new Date("2026-09-06T00:00:00.000Z"),
		});
		expect(calls).toEqual([]);
		expect(status).toBe(200);
		expect(body).toEqual({
			provider: "gateway",
			checkedAt: "2026-09-06T00:00:00.000Z",
			probed: false,
			cached: false,
			probeRefused: false,
			config: { ok: true, problem: null },
			models: {
				agent: { id: AGENT.id, probed: false, ok: null, errorClass: null },
				gate: { id: GATE.id, probed: false, ok: null, errorClass: null },
			},
		});
	});

	test("a provider/id mismatch is a 503 without touching the provider", async () => {
		const { caller, calls } = counting();
		const { status, body } = await agentHealth({
			usingGateway: true,
			agent: { variable: "AGENT_MODEL", id: "minimax/minimax-m3:free" },
			gate: GATE,
			probe: true,
			probeToken: AUTHORISED,
			probeCaller: caller,
		});
		expect(calls).toEqual([]);
		expect(status).toBe(503);
		expect(body.config.ok).toBe(false);
		expect(body.config.problem).toContain("AGENT_MODEL=minimax/minimax-m3:free");
		expect(body.probed).toBe(false);
	});

	test("the provider name follows the credential, not the id", async () => {
		const gateway = await agentHealth({ usingGateway: true, agent: AGENT, gate: GATE, probe: false });
		const openrouter = await agentHealth({ usingGateway: false, agent: AGENT, gate: GATE, probe: false });
		expect([gateway.body.provider, openrouter.body.provider]).toEqual(["gateway", "openrouter"]);
	});
});

describe("?probe=1 runs one call per model and classifies the failure", () => {
	test("both models answering is a 200 and two calls", async () => {
		const { caller, calls } = counting();
		const { status, body } = await agentHealth({
			usingGateway: false,
			agent: AGENT,
			gate: GATE,
			probe: true,
			probeToken: AUTHORISED,
			probeCaller: caller,
		});
		expect(calls.sort()).toEqual([`agent:${AGENT.id}`, `gate:${GATE.id}`]);
		expect(status).toBe(200);
		expect(body.probed).toBe(true);
		expect(body.models.agent).toEqual({ id: AGENT.id, probed: true, ok: true, errorClass: "ok" });
		expect(body.models.gate).toEqual({ id: GATE.id, probed: true, ok: true, errorClass: "ok" });
	});

	test("a failing model is a 503 carrying its class and nothing else", async () => {
		const { caller } = counting((role) => {
			if (role !== "gate") return;
			throw Object.assign(new Error("Rate limit exceeded: free-models-per-day. key sk-or-v1-NOT-A-REAL-KEY"), {
				name: "AI_APICallError",
				statusCode: 429,
			});
		});
		const { status, body } = await agentHealth({
			usingGateway: false,
			agent: AGENT,
			gate: GATE,
			probe: true,
			probeToken: AUTHORISED,
			probeCaller: caller,
		});
		expect(status).toBe(503);
		expect(body.models.agent.ok).toBe(true);
		expect(body.models.gate).toEqual({ id: GATE.id, probed: true, ok: false, errorClass: "rate_limited" });
		// The provider's message never appears anywhere in the answer.
		expect(JSON.stringify(body)).not.toContain("sk-or");
		expect(JSON.stringify(body)).not.toContain("free-models-per-day");
	});

	test("each class the probe can report", async () => {
		const cases: Array<[Record<string, unknown>, AgentErrorClass]> = [
			[{ name: "GatewayModelNotFoundError" }, "model_not_found"],
			[{ name: "AI_APICallError", statusCode: 402 }, "no_credit"],
			[{ name: "AI_APICallError", statusCode: 429 }, "rate_limited"],
			[{ name: "AI_APICallError", statusCode: 503 }, "provider_down"],
			[{ name: "Nonsense" }, "unknown"],
		];
		for (const [fields, expected] of cases) {
			resetProbeCache();
			const { caller } = counting(() => {
				throw Object.assign(new Error("x"), fields);
			});
			const { body } = await agentHealth({
				usingGateway: false,
				agent: AGENT,
				gate: GATE,
				probe: true,
			probeToken: AUTHORISED,
				probeCaller: caller,
			});
			expect({ fields, cls: body.models.agent.errorClass }).toEqual({ fields, cls: expected });
		}
	});
});

describe("the probe cannot be used to burn quota", () => {
	test("a second probe inside the window is served from the cache", async () => {
		const first = counting();
		const start = new Date("2026-09-06T00:00:00.000Z");
		await agentHealth({ usingGateway: false, agent: AGENT, gate: GATE, probe: true, probeToken: AUTHORISED, probeCaller: first.caller, now: start });
		expect(first.calls.length).toBe(2);

		const second = counting();
		const { body } = await agentHealth({
			usingGateway: false,
			agent: AGENT,
			gate: GATE,
			probe: true,
			probeToken: AUTHORISED,
			probeCaller: second.caller,
			now: new Date(start.getTime() + PROBE_CACHE_MS - 1),
		});
		expect(second.calls).toEqual([]);
		expect(body.cached).toBe(true);
		expect(body.checkedAt).toBe(start.toISOString());
	});

	test("ten reloads inside the window cost two calls in total", async () => {
		const { caller, calls } = counting();
		const start = new Date("2026-09-06T00:00:00.000Z");
		for (let i = 0; i < 10; i++) {
			await agentHealth({
				usingGateway: false,
				agent: AGENT,
				gate: GATE,
				probe: true,
			probeToken: AUTHORISED,
				probeCaller: caller,
				now: new Date(start.getTime() + i * 1000),
			});
		}
		expect(calls.length).toBe(2);
	});

	/**
	 * The regression guard for a bug this file caught before it shipped: the
	 * first version reserved the cache slot with a hand-made "everything failed"
	 * body before the calls started, so a request arriving during the round was
	 * told `ok: false` about models that were answering perfectly well. One round
	 * of calls is necessary; lying to the second caller is not.
	 */
	test("two simultaneous probes make one round of calls AND both get the truth", async () => {
		const calls: string[] = [];
		let release: (() => void) | null = null;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const caller: ProbeCaller = async (model) => {
			calls.push(`${model.role}:${model.id}`);
			await gate;
		};
		const now = new Date("2026-09-06T00:00:00.000Z");
		const both = Promise.all([
			agentHealth({ usingGateway: false, agent: AGENT, gate: GATE, probe: true, probeToken: AUTHORISED, probeCaller: caller, now }),
			agentHealth({ usingGateway: false, agent: AGENT, gate: GATE, probe: true, probeToken: AUTHORISED, probeCaller: caller, now }),
		]);
		// Both requests are now inside the window with nothing finished.
		await Promise.resolve();
		(release as unknown as () => void)();
		const [first, second] = await both;
		expect(calls.length).toBe(2);
		// The starter reports a fresh answer; the joiner reports a reused one, so
		// `cached` keeps meaning "this cost nothing".
		expect([first.body.cached, second.body.cached]).toEqual([false, true]);
		for (const answer of [first, second]) {
			expect({ status: answer.status, agent: answer.body.models.agent.ok, gate: answer.body.models.gate.ok }).toEqual({
				status: 200,
				agent: true,
				gate: true,
			});
		}
	});

	test("after the window it probes again", async () => {
		const { caller, calls } = counting();
		const start = new Date("2026-09-06T00:00:00.000Z");
		await agentHealth({ usingGateway: false, agent: AGENT, gate: GATE, probe: true, probeToken: AUTHORISED, probeCaller: caller, now: start });
		await agentHealth({
			usingGateway: false,
			agent: AGENT,
			gate: GATE,
			probe: true,
			probeToken: AUTHORISED,
			probeCaller: caller,
			now: new Date(start.getTime() + PROBE_CACHE_MS),
		});
		expect(calls.length).toBe(4);
	});

	test("a cached FAILING answer keeps its 503", async () => {
		const { caller } = counting(() => {
			throw Object.assign(new Error("x"), { name: "AI_APICallError", statusCode: 402 });
		});
		const start = new Date("2026-09-06T00:00:00.000Z");
		await agentHealth({ usingGateway: false, agent: AGENT, gate: GATE, probe: true, probeToken: AUTHORISED, probeCaller: caller, now: start });
		const again = await agentHealth({
			usingGateway: false,
			agent: AGENT,
			gate: GATE,
			probe: true,
			probeToken: AUTHORISED,
			probeCaller: caller,
			now: new Date(start.getTime() + 1),
		});
		expect({ status: again.status, cached: again.body.cached, cls: again.body.models.agent.errorClass }).toEqual({
			status: 503,
			cached: true,
			cls: "no_credit",
		});
	});
});

/**
 * C-P2-2 (lane C pass 2, MAJOR). `?probe=1` was reachable by anyone and its
 * only spending control was a 60-second PROCESS-LOCAL cache, so a new instance
 * (or a fleet of them) meant new calls. Reviewer measurement on the unfixed
 * module:
 *
 *   {"unauthenticatedWindows":3,"injectedModelCalls":6}
 *   {"afterNewInstance":8}
 *
 * Owner ruling 2026-09-06 03:4x: "don't spam it and finish his credits."
 */
describe("C-P2-2: only an authorised operator can spend model credit", () => {
	test("no token configured — three windows of ?probe=1 make ZERO calls and 403", async () => {
		const { caller, calls } = counting();
		const start = new Date("2026-09-06T00:00:00.000Z");
		const statuses: number[] = [];
		const probed: boolean[] = [];
		for (let i = 0; i < 3; i++) {
			resetProbeCache();
			const answer = await agentHealth({
				usingGateway: false,
				agent: AGENT,
				gate: GATE,
				probe: true,
				probeCaller: caller,
				probeToken: { configured: undefined, presented: "anything-at-all-16" },
				now: new Date(start.getTime() + i * PROBE_CACHE_MS),
			});
			statuses.push(answer.status);
			probed.push(answer.body.probed);
		}
		expect({ unauthenticatedWindows: 3, injectedModelCalls: calls.length, statuses, probed }).toEqual({
			unauthenticatedWindows: 3,
			injectedModelCalls: 0,
			statuses: [403, 403, 403],
			probed: [false, false, false],
		});
	});

	test("a WRONG token makes zero calls and 403", async () => {
		const { caller, calls } = counting();
		const { status, body } = await agentHealth({
			usingGateway: false,
			agent: AGENT,
			gate: GATE,
			probe: true,
			probeCaller: caller,
			probeToken: { configured: OPERATOR_TOKEN, presented: `${OPERATOR_TOKEN}x` },
		});
		expect({ status, calls: calls.length, probed: body.probed, refused: body.probeRefused }).toEqual({
			status: 403,
			calls: 0,
			probed: false,
			refused: true,
		});
	});

	test("a MISSING header makes zero calls and 403", async () => {
		const { caller, calls } = counting();
		const { status } = await agentHealth({
			usingGateway: false,
			agent: AGENT,
			gate: GATE,
			probe: true,
			probeCaller: caller,
			probeToken: { configured: OPERATOR_TOKEN, presented: null },
		});
		expect({ status, calls: calls.length }).toEqual({ status: 403, calls: 0 });
	});

	test("a token SHORTER than the minimum is treated as not configured", async () => {
		const short = "0123456789abcde"; // 15
		expect(short.length).toBe(PROBE_TOKEN_MIN_LENGTH - 1);
		const { caller, calls } = counting();
		const { status } = await agentHealth({
			usingGateway: false,
			agent: AGENT,
			gate: GATE,
			probe: true,
			probeCaller: caller,
			probeToken: { configured: short, presented: short },
		});
		expect({ status, calls: calls.length }).toEqual({ status: 403, calls: 0 });
	});

	test("the RIGHT token runs exactly one round", async () => {
		const { caller, calls } = counting();
		const { status, body } = await agentHealth({
			usingGateway: false,
			agent: AGENT,
			gate: GATE,
			probe: true,
			probeCaller: caller,
			probeToken: { configured: OPERATOR_TOKEN, presented: OPERATOR_TOKEN },
		});
		expect({ status, calls: calls.length, probed: body.probed, refused: body.probeRefused }).toEqual({
			status: 200,
			calls: 2,
			probed: true,
			refused: false,
		});
	});

	test("the plain GET stays public and config-only", async () => {
		const { caller, calls } = counting();
		const { status, body } = await agentHealth({
			usingGateway: false,
			agent: AGENT,
			gate: GATE,
			probe: false,
			probeCaller: caller,
			probeToken: { configured: undefined, presented: null },
		});
		expect({ status, calls: calls.length, probed: body.probed, refused: body.probeRefused }).toEqual({
			status: 200,
			calls: 0,
			probed: false,
			refused: false,
		});
	});

	test("a refused probe answers the SAME body as the plain GET, so it is no oracle", async () => {
		const { caller } = counting();
		const now = new Date("2026-09-06T00:00:00.000Z");
		const plain = await agentHealth({
			usingGateway: false, agent: AGENT, gate: GATE, probe: false, probeCaller: caller, now,
		});
		const notConfigured = await agentHealth({
			usingGateway: false, agent: AGENT, gate: GATE, probe: true, probeCaller: caller,
			probeToken: { configured: undefined, presented: "x" }, now,
		});
		const wrongToken = await agentHealth({
			usingGateway: false, agent: AGENT, gate: GATE, probe: true, probeCaller: caller,
			probeToken: { configured: OPERATOR_TOKEN, presented: "wrong-but-long-enough" }, now,
		});
		expect(notConfigured.body).toEqual(wrongToken.body);
		expect({ ...notConfigured.body, probeRefused: false }).toEqual(plain.body);
	});
});

describe("the route wires the module the way this file tested it", () => {
	const route = read("../../app/api/agent/health/route.ts");

	test("only ?probe=1 probes, and the plain GET is the default", () => {
		expect(route).toContain('searchParams.get("probe") === "1"');
		expect(route).toContain("probe,");
	});

	test("model.ts is imported inside the probe, never at module scope", () => {
		// It throws at load on a mismatch (F-E item 1). A health endpoint that
		// cannot load when the thing it reports on is broken is worthless.
		expect(route).toContain('await import("@/lib/agent/model")');
		expect(route).not.toMatch(/^import .*@\/lib\/agent\/model/m);
	});

	test("the endpoint writes nothing and caches nothing downstream", () => {
		expect(route).toContain('"cache-control": "no-store"');
		expect(route).not.toContain("export async function POST");
		expect(route).not.toContain("db");
	});

	test("the probe asks for the smallest answer a model can give", () => {
		expect(route).toContain("maxOutputTokens: 5");
	});

	/** C-P2-2: the route hands the module BOTH halves of the authorisation. */
	test("the route passes the configured token and the presented header", () => {
		expect(route).toContain("configured: env.AGENT_HEALTH_PROBE_TOKEN");
		expect(route).toContain("presented: request.headers.get(PROBE_TOKEN_HEADER)");
	});
});

/**
 * C-P2-2, driven through the REAL `GET` handler rather than its source text.
 *
 * No model can be reached from here: `route.ts` imports `@/lib/agent/model`
 * INSIDE `probeCaller`, so a refused probe never even loads the provider. The
 * `fetch` trap below makes that a measured fact rather than an argument — any
 * outbound request during these cases fails the test.
 */
describe("C-P2-2: the real endpoint refuses an unauthorised probe", () => {
	const url = "https://example.invalid/api/agent/health";
	const WRONG = "not-the-configured-operator-token";

	/**
	 * B-1. These cases drive the REAL route, which reads `env.AGENT_MODEL` and
	 * `env.AGENT_GATE_MODEL` — so the case must SET them rather than inherit
	 * whatever the developer's `.env.local` happens to hold. They used to inherit,
	 * and on any checkout carrying `AI_GATEWAY_API_KEY` (production parity, and
	 * this worktree) all three failed: `SKIP_ENV_VALIDATION` is set by the test
	 * preload, so zod never parses, the `.default()` never applies, and the ids
	 * were `undefined`.
	 *
	 * Setting `process.env` does NOT reach `env` — `@nuts/env/server` snapshots
	 * `process.env` at import (measured 2026-09-06: in a full-directory run the
	 * module is already loaded before this file's body executes, and the mutation
	 * is invisible). The values are therefore written onto the `env` object itself
	 * and restored afterwards, so nothing leaks into the other files sharing this
	 * process.
	 *
	 * `AI_GATEWAY_API_KEY` is deliberately NOT pinned: with two non-`:free` ids
	 * the configuration is valid under either provider, so these three cases must
	 * pass with the gateway key present AND absent. Both were measured.
	 */
	const FIXTURE_IDS = {
		AGENT_MODEL: "anthropic/claude-haiku-4.5",
		AGENT_GATE_MODEL: "anthropic/claude-haiku-4.5",
	} as const;

	async function withFixtureModelIds<T>(run: () => Promise<T>): Promise<T> {
		const { env } = (await import("@nuts/env/server")) as unknown as { env: Record<string, unknown> };
		const before = new Map(Object.keys(FIXTURE_IDS).map((key) => [key, env[key]]));
		Object.assign(env, FIXTURE_IDS);
		try {
			return await run();
		} finally {
			for (const [key, value] of before) {
				if (value === undefined) delete env[key];
				else env[key] = value;
			}
		}
	}

	async function call(target: string, headers: Record<string, string> = {}) {
		const { GET } = await import("../../app/api/agent/health/route");
		const realFetch = globalThis.fetch;
		const attempts: string[] = [];
		globalThis.fetch = (async (input: unknown) => {
			attempts.push(String(input));
			throw new Error("no network in this test");
		}) as unknown as typeof fetch;
		try {
			const response = await withFixtureModelIds(() => GET(new Request(target, { headers })));
			return { response, body: (await response.json()) as { probed: boolean; probeRefused: boolean }, attempts };
		} finally {
			globalThis.fetch = realFetch;
		}
	}

	test("?probe=1 with no usable token is a 403 and makes no request at all", async () => {
		const { response, body, attempts } = await call(`${url}?probe=1`, { [PROBE_TOKEN_HEADER]: WRONG });
		expect({ status: response.status, probed: body.probed, refused: body.probeRefused, attempts }).toEqual({
			status: 403,
			probed: false,
			refused: true,
			attempts: [],
		});
	});

	test("?probe=1 with NO header at all is a 403", async () => {
		const { response, body } = await call(`${url}?probe=1`);
		expect({ status: response.status, refused: body.probeRefused }).toEqual({ status: 403, refused: true });
	});

	test("the plain GET is still public, free and 200", async () => {
		const { response, body, attempts } = await call(url);
		expect({ status: response.status, probed: body.probed, refused: body.probeRefused, attempts }).toEqual({
			status: 200,
			probed: false,
			refused: false,
			attempts: [],
		});
	});
});
