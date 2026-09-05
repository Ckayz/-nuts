import { generateText } from "ai";
import { env } from "@nuts/env/server";

import { PROBE_TOKEN_HEADER, agentHealth, type ProbeCaller } from "@/lib/agent/health";

/**
 * F-E item 2. Why the agent is failing, in one URL, without a browser round trip
 * through a sentence that means three different things.
 *
 * `GET /api/agent/health`
 *   Configuration only. NO model is called, so it costs nothing and an uptime
 *   monitor may poll it. 200 when the provider and the configured ids agree,
 *   503 when they do not — which is the failure that actually took the agent
 *   down on 2026-09-06 (`da09e81`).
 *
 * `GET /api/agent/health?probe=1`
 *   Additionally makes ONE tiny real call per configured model. This spends the
 *   deployment's model credit, so it is OPERATOR-ONLY: it runs only when
 *   `AGENT_HEALTH_PROBE_TOKEN` is configured (16 characters or more) AND the
 *   request presents it in the `x-agent-probe-token` header. Anything else is a
 *   403 carrying the same body the plain GET returns, and no model is called.
 *   Monitors must NOT use it. An authorised answer is still cached for a window
 *   (`PROBE_CACHE_MS`), so an operator reloading cannot burn quota either.
 *
 * C-P2-2 (one-shot review pass 2): the probe used to be unauthenticated, with
 * that 60-second cache as its only spending control — and the cache is
 * process-local, so a second instance meant a second round of calls (reviewer:
 * three windows = six calls; a fresh instance = eight). Against the owner's
 * "don't spam it and finish his credits", so the paid branch now fails closed.
 *
 * The PLAIN GET stays unauthenticated by design: it must answer when the agent
 * cannot, it calls nothing, and it returns nothing an attacker gains from — a
 * provider name, two model ids that are already in `.env.example`, and a fixed
 * error class. No key, no provider message, no request body, nothing written.
 */

export const dynamic = "force-dynamic";

/**
 * The smallest call that still proves the model answers: a two-token completion.
 *
 * `model.ts` is imported HERE rather than at module scope on purpose — it throws
 * at load when the id and the provider disagree, and a health endpoint that
 * cannot load when the thing it reports on is broken is worthless. The plain GET
 * never reaches this function.
 */
const probeCaller: ProbeCaller = async (model) => {
	const { agentModel, gateModel } = await import("@/lib/agent/model");
	await generateText({
		model: model.role === "gate" ? gateModel : agentModel,
		prompt: "Reply with the single word: ok",
		temperature: 0,
		// TODO-OWNER: the probe's token ceiling. Two tokens is enough to prove the
		// provider answered; nothing reads the text.
		maxOutputTokens: 5,
	});
};

export async function GET(request: Request) {
	const probe = new URL(request.url).searchParams.get("probe") === "1";
	const { status, body } = await agentHealth({
		usingGateway: Boolean(env.AI_GATEWAY_API_KEY),
		agent: { variable: "AGENT_MODEL", id: env.AGENT_MODEL },
		gate: { variable: "AGENT_GATE_MODEL", id: env.AGENT_GATE_MODEL },
		probe,
		// C-P2-2. The only thing that lets this request spend money. Both halves
		// come from outside this module and both are checked in `health.ts`.
		probeToken: {
			configured: env.AGENT_HEALTH_PROBE_TOKEN,
			presented: request.headers.get(PROBE_TOKEN_HEADER),
		},
		probeCaller,
	});
	return Response.json(body, {
		status,
		// A cached answer inside the window is still a fresh fact about the window;
		// nothing here may be stored by a CDN.
		headers: { "cache-control": "no-store" },
	});
}
