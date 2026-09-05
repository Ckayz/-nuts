/**
 * F-E item 2. `/api/agent/health` — what an operator opens when someone says
 * "the agent is broken", instead of reading a browser sentence that means three
 * different things.
 *
 * OWNER RULING 2026-09-06 03:4x (verbatim intent): the deployment keeps the
 * Vercel AI Gateway with the paid model, and the teammate's gateway credit is
 * NOT to be spent by anything but real usage — "don't spam it and finish his
 * credits. in fact don't use it other than confirming once that it works is
 * enough". So the plain GET calls NO model at all: it answers from
 * configuration, which is where the failure that took the agent down actually
 * lived. A real call happens only when a human asks for it with `?probe=1`, and
 * even then at most once per window.
 *
 * This module is pure logic over an injected caller. `mock.module` is
 * process-wide in bun (measured by lane C), so the probe is a PARAMETER, never a
 * mocked import.
 */
import type { AgentErrorClass } from "./errors";
import { classifyAgentError } from "./errors";
import { type ConfiguredModel, providerModelProblem, providerName } from "./model-config";

/**
 * How long a probed answer is reused, and therefore the shortest interval at
 * which `?probe=1` can spend model credit. One request per window per running
 * instance, no matter how many people reload.
 *
 * TODO-OWNER: 60 seconds is provisional and nobody's number yet.
 */
export const PROBE_CACHE_MS = 60_000;

export interface ModelHealth {
	readonly id: string;
	/** False on the plain GET: nothing was called, so nothing is known. */
	readonly probed: boolean;
	/** `null` when `probed` is false. */
	readonly ok: boolean | null;
	/** `null` when `probed` is false; otherwise one of the fixed classes. */
	readonly errorClass: AgentErrorClass | null;
}

export interface HealthBody {
	readonly provider: "gateway" | "openrouter";
	readonly checkedAt: string;
	readonly probed: boolean;
	/** True when the answer was served from the window's cache rather than re-run. */
	readonly cached: boolean;
	readonly config: { readonly ok: boolean; readonly problem: string | null };
	readonly models: { readonly agent: ModelHealth; readonly gate: ModelHealth };
}

/** One minimal real call. Resolves on success, throws the provider's error. */
export type ProbeCaller = (model: ConfiguredModel & { readonly role: "agent" | "gate" }) => Promise<void>;

export interface HealthInput {
	readonly usingGateway: boolean;
	readonly agent: ConfiguredModel;
	readonly gate: ConfiguredModel;
	/** True only when the caller asked for it explicitly (`?probe=1`). */
	readonly probe: boolean;
	readonly probeCaller?: ProbeCaller;
	readonly now?: Date;
}

/** The window's finished probe, if any. Module state: one per server instance. */
let cached: { at: number; body: HealthBody } | null = null;

/**
 * The probe currently in flight, if any.
 *
 * Two requests arriving together must make ONE round of calls, and the second
 * must be told the truth rather than a placeholder. An earlier version reserved
 * the cache slot with a hand-made "everything failed" body before the calls
 * started, which met the first requirement by breaking the second: a concurrent
 * reader was told `ok: false` about a model that was answering fine. Sharing the
 * promise meets both.
 */
let inflight: { at: number; promise: Promise<{ agent: ModelHealth; gate: ModelHealth }> } | null = null;

/** Tests only: forget the window so a case starts from a known state. */
export function resetProbeCache(): void {
	cached = null;
	inflight = null;
}

async function probeOne(
	role: "agent" | "gate",
	model: ConfiguredModel,
	caller: ProbeCaller,
): Promise<ModelHealth> {
	try {
		await caller({ ...model, role });
		return { id: model.id, probed: true, ok: true, errorClass: "ok" };
	} catch (error) {
		// The class, and only the class. The provider's own message never appears
		// in this response: an unauthenticated endpoint is the last place to echo
		// one back.
		const errorClass = classifyAgentError(error);
		console.error(`[agent/health] ${role} probe failed [${errorClass}] model=${model.id}:`, error);
		return { id: model.id, probed: true, ok: false, errorClass };
	}
}

/**
 * The health answer, and the HTTP status an uptime monitor should read.
 *
 * 503 whenever something is actually wrong — the configuration contradicts
 * itself, or a probe that ran came back failing — so a monitor can watch the
 * status code alone. A monitor must poll WITHOUT `?probe=1`: the plain GET
 * costs nothing, and the probe spends real credit.
 */
export async function agentHealth(input: HealthInput): Promise<{ status: number; body: HealthBody }> {
	const now = input.now ?? new Date();
	const problem = providerModelProblem({
		usingGateway: input.usingGateway,
		models: [input.agent, input.gate],
	});
	const configOk = problem === null;

	const unprobed = (model: ConfiguredModel): ModelHealth => ({
		id: model.id,
		probed: false,
		ok: null,
		errorClass: null,
	});

	if (!input.probe || input.probeCaller === undefined) {
		return {
			status: configOk ? 200 : 503,
			body: {
				provider: providerName(input.usingGateway),
				checkedAt: now.toISOString(),
				probed: false,
				cached: false,
				config: { ok: configOk, problem },
				models: { agent: unprobed(input.agent), gate: unprobed(input.gate) },
			},
		};
	}

	// A misconfigured id is known to fail without asking the provider, and asking
	// anyway would spend credit to learn what the check already knows.
	if (!configOk) {
		return {
			status: 503,
			body: {
				provider: providerName(input.usingGateway),
				checkedAt: now.toISOString(),
				probed: false,
				cached: false,
				config: { ok: false, problem },
				models: { agent: unprobed(input.agent), gate: unprobed(input.gate) },
			},
		};
	}

	const at = now.getTime();
	if (cached !== null && at - cached.at < PROBE_CACHE_MS) {
		const body = { ...cached.body, cached: true };
		return { status: body.models.agent.ok === true && body.models.gate.ok === true ? 200 : 503, body };
	}

	// The in-flight round is claimed BEFORE the calls start, so two requests
	// arriving together share one round instead of each spending credit.
	const shared =
		inflight !== null && at - inflight.at < PROBE_CACHE_MS
			? inflight
			: {
					at,
					promise: (async () => {
						const caller = input.probeCaller as ProbeCaller;
						const [agent, gate] = await Promise.all([
							probeOne("agent", input.agent, caller),
							probeOne("gate", input.gate, caller),
						]);
						return { agent, gate };
					})(),
				};
	const joined = inflight === shared;
	inflight = shared;

	let models: { agent: ModelHealth; gate: ModelHealth };
	try {
		models = await shared.promise;
	} finally {
		// Only the request that STARTED the round clears it, so a late joiner
		// cannot drop the slot out from under another one.
		if (!joined && inflight === shared) inflight = null;
	}

	const body: HealthBody = {
		provider: providerName(input.usingGateway),
		checkedAt: now.toISOString(),
		probed: true,
		cached: joined,
		config: { ok: true, problem: null },
		models,
	};
	if (!joined) cached = { at, body };
	return { status: models.agent.ok === true && models.gate.ok === true ? 200 : 503, body };
}
