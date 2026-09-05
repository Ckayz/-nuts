/**
 * F-E item 4. The gate's retry RULE, and the two call shapes it chooses between.
 *
 * WHY THERE ARE TWO SHAPES, measured 2026-09-06 03:5x with the owner's
 * OpenRouter key, five runs per row at the unchanged `maxOutputTokens: 120`:
 *
 *   anthropic/claude-haiku-4.5   schema shape (today's)   5/5 pass
 *   minimax/minimax-m3:free      schema shape             0/5 — every run
 *                                `AI_NoObjectGeneratedError`, cause
 *                                `AI_JSONParseError`, prose instead of JSON
 *   minimax/minimax-m3:free      no-schema shape          5/5 pass
 *
 * And why, from the installed bytes rather than from a guess:
 * `@openrouter/ai-sdk-provider@3.0.0` sends `response_format: json_schema` with
 * `strict: true` whenever a schema is present and `json_object` when it is not,
 * while `ai@7.0.92`'s `generateObject` always passes the schema — so the gate
 * could only ever ask in the strict form.
 *
 * Zero model calls happen in this file: the two shapes are injected.
 */
import { describe, expect, test } from "bun:test";
import { NoObjectGeneratedError } from "ai";
import { readFileSync } from "node:fs";

import { withJsonShapeFallback } from "./json-shape";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const OK = { inScope: true, reason: "options question" };

/** The error `generateObject` actually threw on every free-model run. */
function parseFailure(): unknown {
	// Built with the SDK's own class so `NoObjectGeneratedError.isInstance` — the
	// exact check the rule makes — is what decides, not a name string.
	return new NoObjectGeneratedError({
		message: "No object generated: could not parse the response.",
		cause: Object.assign(new Error("JSON parsing failed"), { name: "AI_JSONParseError" }),
		text: "inScope. The user is asking about a put option, which is a fundamental options trading concept.",
		response: { id: "r", timestamp: new Date(0), modelId: "m" },
		usage: {
			inputTokens: 1,
			outputTokens: 1,
			totalTokens: 2,
			inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
			outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
		},
		finishReason: "stop",
	});
}

describe("F-E item 4: the loose shape is a fallback, not a switch", () => {
	test("the strict shape answering is the whole story — the loose one never runs", async () => {
		let loose = 0;
		const result = await withJsonShapeFallback(
			async () => OK,
			async () => {
				loose += 1;
				return OK;
			},
		);
		expect({ result, loose }).toEqual({ result: OK, loose: 0 });
	});

	test("an unparseable answer falls back exactly once", async () => {
		let strict = 0;
		let loose = 0;
		const result = await withJsonShapeFallback(
			async () => {
				strict += 1;
				throw parseFailure();
			},
			async () => {
				loose += 1;
				return OK;
			},
		);
		expect({ result, strict, loose }).toEqual({ result: OK, strict: 1, loose: 1 });
	});

	test("the fallback is announced so an operator sees it in the log", async () => {
		let announced = 0;
		await withJsonShapeFallback(
			async () => {
				throw parseFailure();
			},
			async () => OK,
			() => {
				announced += 1;
			},
		);
		expect(announced).toBe(1);
	});

	test("a 429, a 402 and a missing model are NOT retried", async () => {
		for (const fields of [
			{ name: "AI_APICallError", statusCode: 429 },
			{ name: "AI_APICallError", statusCode: 402 },
			{ name: "GatewayModelNotFoundError" },
		]) {
			let loose = 0;
			const thrown = Object.assign(new Error("x"), fields);
			await expect(
				withJsonShapeFallback(
					async () => {
						throw thrown;
					},
					async () => {
						loose += 1;
						return OK;
					},
				),
			).rejects.toThrow("x");
			// Retrying these would double the cost of a failure that cannot succeed.
			expect({ fields, loose }).toEqual({ fields, loose: 0 });
		}
	});

	test("a loose shape that also fails is reported, not swallowed", async () => {
		await expect(
			withJsonShapeFallback(
				async () => {
					throw parseFailure();
				},
				async () => {
					throw Object.assign(new Error("still bad"), { name: "AI_APICallError", statusCode: 429 });
				},
			),
		).rejects.toThrow("still bad");
	});
});

describe("F-E item 4: the shapes are wired the way this file tested the rule", () => {
	const scope = read("./scope.ts");

	/** Comment lines mention the numbers too; only the calls are the contract. */
	const codeLines = scope
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"));

	test("the strict shape runs first and is unchanged", () => {
		expect(scope).toContain("schema: decisionSchema");
		// The owner's number, untouched — both shapes ask for the same ceiling.
		expect(codeLines.filter((line) => line.includes("maxOutputTokens: 120")).length).toBe(2);
		expect(codeLines.filter((line) => /maxOutputTokens: (?!120)\d+/.test(line))).toEqual([]);
	});

	test("the loose shape validates with the SAME schema, so nothing is loosened but the ASK", () => {
		expect(scope).toContain('output: "no-schema"');
		expect(scope).toContain("decisionSchema.parse(object)");
	});

	test("the model ids are untouched: this changes the call shape, never the model", () => {
		// F-E is not allowed to pick models (owner's open decision), and both calls
		// go to the SAME configured gate model.
		expect(scope.match(/model: gateModel/g)?.length ?? 0).toBe(2);
		for (const id of ["minimax", "nemotron", "haiku", "claude-"]) {
			// Named only inside comments recording measurements, never in a call.
			const inCode = scope
				.split("\n")
				.filter((line) => line.includes(id) && !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"));
			expect(inCode, id).toEqual([]);
		}
	});

	test("the gate is still fail-closed and still returns a class", () => {
		expect(scope).toContain("degraded: true");
		expect(scope).toContain("const errorClass = classifyAgentError(error);");
	});
});
