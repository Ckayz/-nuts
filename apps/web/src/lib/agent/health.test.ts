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
import { PROBE_CACHE_MS, type ProbeCaller, agentHealth, resetProbeCache } from "./health";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const AGENT = { variable: "AGENT_MODEL", id: "anthropic/claude-haiku-4.5" } as const;
const GATE = { variable: "AGENT_GATE_MODEL", id: "anthropic/claude-haiku-4.5" } as const;

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
		await agentHealth({ usingGateway: false, agent: AGENT, gate: GATE, probe: true, probeCaller: first.caller, now: start });
		expect(first.calls.length).toBe(2);

		const second = counting();
		const { body } = await agentHealth({
			usingGateway: false,
			agent: AGENT,
			gate: GATE,
			probe: true,
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
			agentHealth({ usingGateway: false, agent: AGENT, gate: GATE, probe: true, probeCaller: caller, now }),
			agentHealth({ usingGateway: false, agent: AGENT, gate: GATE, probe: true, probeCaller: caller, now }),
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
		await agentHealth({ usingGateway: false, agent: AGENT, gate: GATE, probe: true, probeCaller: caller, now: start });
		await agentHealth({
			usingGateway: false,
			agent: AGENT,
			gate: GATE,
			probe: true,
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
		await agentHealth({ usingGateway: false, agent: AGENT, gate: GATE, probe: true, probeCaller: caller, now: start });
		const again = await agentHealth({
			usingGateway: false,
			agent: AGENT,
			gate: GATE,
			probe: true,
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
});
