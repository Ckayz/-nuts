/**
 * F-E items 1–3. The classifier, the boot consistency check and what the browser
 * is allowed to print.
 *
 * The error shapes below are not invented. Each one is either a shape read out
 * of an installed package's declarations or a shape MEASURED against a live
 * provider on 2026-09-06 03:5x with the owner's OpenRouter key:
 *
 *   does/not-exist-xyz     AI_APICallError statusCode 400
 *                          "does/not-exist-xyz is not a valid model ID"
 *   minimax/minimax-m3:free (strict JSON shape, 5 runs)
 *                          AI_NoObjectGeneratedError, cause AI_JSONParseError
 *
 * Zero model calls happen in this file.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
	AGENT_ERROR_SENTENCES,
	type AgentErrorClass,
	agentErrorMessage,
	agentErrorSentence,
	classifyAgentError,
} from "./errors";
import { providerModelProblem, providerName } from "./model-config";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** An error carrying the fields the AI SDK's own classes carry. */
function sdkError(fields: Record<string, unknown>): Error {
	return Object.assign(new Error(String(fields.message ?? "x")), fields);
}

describe("F-E item 2: classifyAgentError", () => {
	test("the gateway's own error names, exactly as @ai-sdk/gateway declares them", () => {
		// Read from the INSTALLED package rather than trusted to memory: if the
		// names in the classifier ever stop existing there, this fails. Resolved
		// through `ai`'s own directory because bun's isolated store does not put
		// `ai`'s transitive dependencies where `apps/web` can resolve them, and a
		// version-stamped path would rot on the next upgrade.
		const aiDist = new URL(".", import.meta.resolve("ai")).pathname;
		const gatewayEntry = Bun.resolveSync("@ai-sdk/gateway", aiDist);
		const declarations = readFileSync(gatewayEntry.replace(/index\.js$/, "index.d.ts"), "utf8");
		const cases: Array<[string, AgentErrorClass]> = [
			["GatewayModelNotFoundError", "model_not_found"],
			["GatewayNotFoundError", "model_not_found"],
			["GatewayRateLimitError", "rate_limited"],
			["GatewayAuthenticationError", "no_credit"],
			["GatewayForbiddenError", "no_credit"],
			["GatewayInternalServerError", "provider_down"],
			["GatewayFailedDependencyError", "provider_down"],
			["GatewayResponseError", "provider_down"],
		];
		for (const [name, expected] of cases) {
			expect(declarations, name).toContain(`readonly name = "${name}"`);
			expect({ name, cls: classifyAgentError(sdkError({ name })) }).toEqual({ name, cls: expected });
		}
	});

	test("the exact GatewayModelNotFoundError that took the agent down", () => {
		// `da09e81`'s commit message, verbatim.
		const error = sdkError({
			name: "GatewayModelNotFoundError",
			type: "model_not_found",
			statusCode: 404,
			modelId: "minimax/minimax-m3:free",
			message: "Model 'minimax/minimax-m3:free' not found",
		});
		expect(classifyAgentError(error)).toBe("model_not_found");
		expect(agentErrorSentence(error)).toBe(AGENT_ERROR_SENTENCES.model_not_found);
	});

	test("OpenRouter's measured unknown-model answer is a 400, not a 404", () => {
		const error = sdkError({
			name: "AI_APICallError",
			statusCode: 400,
			url: "https://openrouter.ai/api/v1/chat/completions",
			message: "does/not-exist-xyz is not a valid model ID",
		});
		expect(classifyAgentError(error)).toBe("model_not_found");
		// A plain 400 that is NOT about a model stays unknown, so the sentence
		// cannot promise a misconfiguration that is not there.
		expect(classifyAgentError(sdkError({ name: "AI_APICallError", statusCode: 400, message: "bad request" }))).toBe(
			"unknown",
		);
	});

	test("OpenRouter's free-tier 429 body shape", () => {
		// The body OpenRouter returns, as recorded in packages/env/src/server.ts
		// from a real 429 on this account: "Rate limit exceeded:
		// free-models-per-day", X-RateLimit-Limit: 50.
		const error = sdkError({
			name: "AI_APICallError",
			statusCode: 429,
			responseHeaders: { "x-ratelimit-limit": "50" },
			responseBody: '{"error":{"code":429,"message":"Rate limit exceeded: free-models-per-day."}}',
			message: "Rate limit exceeded: free-models-per-day.",
			isRetryable: true,
		});
		expect(classifyAgentError(error)).toBe("rate_limited");
		expect(agentErrorSentence(error)).toBe(AGENT_ERROR_SENTENCES.rate_limited);
	});

	test("money and credential statuses", () => {
		for (const status of [401, 402, 403]) {
			expect({ status, cls: classifyAgentError(sdkError({ name: "AI_APICallError", statusCode: status })) }).toEqual({
				status,
				cls: "no_credit",
			});
		}
		expect(classifyAgentError(sdkError({ name: "AI_LoadAPIKeyError" }))).toBe("no_credit");
	});

	test("the provider's own side: 5xx, network codes and a fetch TypeError", () => {
		for (const status of [500, 502, 503, 504]) {
			expect({ status, cls: classifyAgentError(sdkError({ name: "AI_APICallError", statusCode: status })) }).toEqual({
				status,
				cls: "provider_down",
			});
		}
		expect(classifyAgentError(sdkError({ name: "Error", code: "ECONNREFUSED" }))).toBe("provider_down");
		expect(classifyAgentError(sdkError({ name: "TypeError", message: "fetch failed" }))).toBe("provider_down");
	});

	test("the decisive error one and two layers down is found", () => {
		// `ai@7.0.92` wraps the attempts it gave up on in RetryError.lastError.
		const retry = sdkError({
			name: "AI_RetryError",
			message: "Failed after 3 attempts",
			lastError: sdkError({ name: "AI_APICallError", statusCode: 429 }),
			errors: [sdkError({ name: "AI_APICallError", statusCode: 429 })],
		});
		expect(classifyAgentError(retry)).toBe("rate_limited");
		// …and through `cause`, which is how generateObject reports a parse failure.
		expect(
			classifyAgentError(
				sdkError({ name: "Wrapper", cause: sdkError({ name: "GatewayRateLimitError" }) }),
			),
		).toBe("rate_limited");
		// A bare RetryError with nothing usable inside is still the provider's side.
		expect(classifyAgentError(sdkError({ name: "AI_RetryError" }))).toBe("provider_down");
	});

	test("a cause that points at itself terminates", () => {
		const loop: Record<string, unknown> = { name: "Weird" };
		loop.cause = loop;
		expect(classifyAgentError(loop)).toBe("unknown");
	});

	test("anything unrecognised is `unknown`, never a guess", () => {
		for (const value of [null, undefined, "a string", 42, {}, new Error("boom")]) {
			expect(classifyAgentError(value)).toBe("unknown");
		}
		// The measured free-model parse failure has no status and no known name, so
		// it must NOT be reported as a provider outage or a money problem.
		expect(
			classifyAgentError(
				sdkError({
					name: "AI_NoObjectGeneratedError",
					message: "No object generated: could not parse the response.",
					cause: sdkError({ name: "AI_JSONParseError", message: "JSON parsing failed" }),
				}),
			),
		).toBe("unknown");
	});

	test("no sentence ever carries provider text", () => {
		const leaky = sdkError({
			name: "AI_APICallError",
			statusCode: 402,
			message: "sk-or-v1-SECRET is out of credit at https://openrouter.ai/credits",
			responseBody: "sk-or-v1-SECRET",
		});
		const sentence = agentErrorSentence(leaky);
		expect(sentence).toBe(AGENT_ERROR_SENTENCES.no_credit);
		expect(sentence).not.toContain("sk-or");
		expect(sentence).not.toContain("openrouter");
	});
});

describe("F-E item 3: what the browser prints", () => {
	test("a streamed sentence is shown; anything else is not", () => {
		for (const sentence of Object.values(AGENT_ERROR_SENTENCES)) {
			expect(agentErrorMessage(new Error(sentence), "fallback")).toBe(sentence);
		}
		// Provider text that somehow reached the client is refused.
		expect(agentErrorMessage(new Error("402 Insufficient credits for key sk-or-v1-…"), "fallback")).toBe("fallback");
		expect(agentErrorMessage(new Error(""), "fallback")).toBe("fallback");
		expect(agentErrorMessage(undefined, "fallback")).toBe("fallback");
	});

	test("a JSON body is trusted only with this app's own marker", () => {
		const mine = JSON.stringify({ error: "Daily limit reached: 10 turns.", source: "agent" });
		expect(agentErrorMessage(new Error(mine), "fallback")).toBe("Daily limit reached: 10 turns.");
		// The same body without the marker — e.g. some proxy's JSON — is refused.
		expect(agentErrorMessage(new Error(JSON.stringify({ error: "leaked provider text" })), "fallback")).toBe(
			"fallback",
		);
		expect(agentErrorMessage(new Error('{"error":"x","source":"elsewhere"}'), "fallback")).toBe("fallback");
		expect(agentErrorMessage(new Error("{not json at all"), "fallback")).toBe("fallback");
		expect(agentErrorMessage(new Error('{"source":"agent"}'), "fallback")).toBe("fallback");
	});

	test("the 503 the route writes for a degraded gate round-trips", () => {
		// Exactly what `route.ts` builds, then exactly what the transport does with
		// it: `new Error(await response.text())` for a non-OK response.
		const body = JSON.stringify({
			error: `The agent's safety check could not run, so this message was not sent. ${AGENT_ERROR_SENTENCES.rate_limited}`,
			source: "agent",
		});
		expect(agentErrorMessage(new Error(body), "fallback")).toContain(AGENT_ERROR_SENTENCES.rate_limited);
	});
});

describe("F-E item 1: the id and the provider must agree", () => {
	test("a `:free` id under the gateway is refused, and the message names the fix", () => {
		const problem = providerModelProblem({
			usingGateway: true,
			models: [
				{ variable: "AGENT_MODEL", id: "minimax/minimax-m3:free" },
				{ variable: "AGENT_GATE_MODEL", id: "anthropic/claude-haiku-4.5" },
			],
		});
		expect(problem).not.toBeNull();
		expect(problem).toContain("AGENT_MODEL=minimax/minimax-m3:free");
		expect(problem).toContain("AI_GATEWAY_API_KEY");
		expect(problem).toContain("GatewayModelNotFoundError");
	});

	test("the gate model is checked too, not only the primary", () => {
		const problem = providerModelProblem({
			usingGateway: true,
			models: [
				{ variable: "AGENT_MODEL", id: "anthropic/claude-haiku-4.5" },
				{ variable: "AGENT_GATE_MODEL", id: "nvidia/nemotron-3.5-lightning:free" },
			],
		});
		expect(problem).toContain("AGENT_GATE_MODEL=nvidia/nemotron-3.5-lightning:free");
	});

	test("both directions: the same ids are FINE on OpenRouter", () => {
		// Measured 2026-09-06: `minimax/minimax-m3:free` answers on OpenRouter with
		// the owner's key (5/5 through the gate's loose shape). Only the pairing is
		// wrong, so no error may fire when the gateway is not in play.
		expect(
			providerModelProblem({
				usingGateway: false,
				models: [
					{ variable: "AGENT_MODEL", id: "minimax/minimax-m3:free" },
					{ variable: "AGENT_GATE_MODEL", id: "minimax/minimax-m3:free" },
				],
			}),
		).toBeNull();
		// And a paid id under the gateway is what production runs today.
		expect(
			providerModelProblem({
				usingGateway: true,
				models: [
					{ variable: "AGENT_MODEL", id: "anthropic/claude-haiku-4.5" },
					{ variable: "AGENT_GATE_MODEL", id: "anthropic/claude-haiku-4.5" },
				],
			}),
		).toBeNull();
	});

	test("providerName says which provider the credential selects", () => {
		expect([providerName(true), providerName(false)]).toEqual(["gateway", "openrouter"]);
	});

	test("model.ts throws the problem at module load, not on a turn", () => {
		const source = read("./model.ts");
		expect(source).toContain("providerModelProblem({");
		expect(source).toContain("if (configProblem !== null) throw new Error(configProblem);");
		// Before either model is resolved, so no turn can be served with a broken
		// pairing.
		expect(source.indexOf("if (configProblem !== null)")).toBeLessThan(source.indexOf("export const agentModel"));
	});
});

describe("F-E item 3: the three paths all classify through this file", () => {
	test("the chat route logs the class and answers with the class's sentence", () => {
		const route = read("../../app/api/agent/chat/route.ts");
		expect(route).toContain("return agentErrorSentence(error);");
		expect(route).toContain("classifyAgentError(error)");
		expect(route).toContain("model=${env.AGENT_MODEL}");
		// The old one-sentence-for-everything answer is gone.
		expect(route).not.toContain("The agent is unavailable right now. Please try again.");
		// Every JSON failure carries the marker the client checks for.
		expect(route).toContain('Response.json({ error: message, source: "agent" }');
		expect(route.match(/Response\.json\(\{ error:/g)?.length ?? 0).toBe(1);
	});

	test("the scope gate returns the class rather than swallowing it", () => {
		const scope = read("./scope.ts");
		expect(scope).toContain("const errorClass = classifyAgentError(error);");
		expect(scope).toContain("errorClass,");
		// Still fail-closed: PRD 10.8 layer 1 that did not run is a refusal.
		const route = read("../../app/api/agent/chat/route.ts");
		expect(route).toContain("if (scope.degraded)");
		expect(route).toContain("503");
	});

	test("the chat component prints the server's sentence when there is one", () => {
		const component = read("../../components/agent/agent-chat.tsx");
		expect(component).toContain("agentErrorMessage(error, COPY.error)");
	});
});
