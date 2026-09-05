/**
 * F-E (owner 2026-09-06 03:3x, verbatim: "the ai part, figure a way out. we
 * can't keep failing"). ONE classifier for every way a model call can fail, and
 * one provisional sentence per class.
 *
 * Why this file exists: three different failures all reached the user as the
 * same sentence, so nobody — user or operator — could tell them apart.
 *   1. the model id did not exist on the provider the deployment routes through
 *      (`GatewayModelNotFoundError`; the route still answered HTTP 200),
 *   2. the provider refused for money reasons (402/401),
 *   3. the free tier's daily allowance was spent (429).
 * The chat route's `onError`, the scope gate's catch and `/api/agent/health` all
 * classify through the functions here, so the three paths cannot drift.
 *
 * NO `server-only`: `components/agent/agent-chat.tsx` imports
 * `agentErrorMessage` to decide what a failed turn shows.
 *
 * Nothing here ever returns provider text. Every classification is made from an
 * error's NAME, its STATUS CODE and (for one measured case) a short id-shaped
 * phrase — never by forwarding a message the provider wrote.
 */

/**
 * The classes an operator can act on. Deliberately small: each one has a
 * different fix, and a class nobody can act on differently is noise.
 *
 * `no_credit` covers BOTH "the account has no credit" (402) and "the key was
 * rejected" (401/403) because the sentence and the fix are the same person's
 * job — the deployment's model credential. TODO-OWNER: whether a bad key
 * deserves its own class in the health output.
 */
export type AgentErrorClass =
	| "ok"
	| "model_not_found"
	| "no_credit"
	| "rate_limited"
	| "provider_down"
	| "unknown";

/**
 * What the user is told, per class. Every line is provisional — the mockup
 * draws no agent view and the PRD sets no wording for one.
 * TODO-OWNER: all five sentences.
 */
export const AGENT_ERROR_SENTENCES: Record<Exclude<AgentErrorClass, "ok">, string> = {
	model_not_found: "The agent is misconfigured: its model is not available on this deployment's provider.",
	no_credit: "The agent's model account is out of credit, or its key was rejected.",
	rate_limited: "The agent's model quota is used up for now. Try again later.",
	provider_down: "The model provider is not responding right now. Try again shortly.",
	unknown: "The agent could not complete that. Try again shortly.",
};

/** Every sentence this app may show for a failed turn, for the client's allowlist. */
const KNOWN_SENTENCES: ReadonlySet<string> = new Set(Object.values(AGENT_ERROR_SENTENCES));

/**
 * Error NAMES that decide a class on their own.
 *
 * Read from the installed packages, not from memory:
 * `@ai-sdk/gateway@4.0.74` `dist/index.d.ts` declares each class with a literal
 * `readonly name`, and the gateway is what production routes through, so these
 * are the names that reach `onError` there.
 */
const NAMED: Readonly<Record<string, Exclude<AgentErrorClass, "ok">>> = {
	// dist/index.d.ts:1285 — `readonly name = "GatewayModelNotFoundError"`.
	GatewayModelNotFoundError: "model_not_found",
	// :1306 — the resource, not the model, but still nothing to retry.
	GatewayNotFoundError: "model_not_found",
	// :1323
	GatewayRateLimitError: "rate_limited",
	// :1184 and :1232 — a credential the deployment owns.
	GatewayAuthenticationError: "no_credit",
	GatewayForbiddenError: "no_credit",
	// :1251, :1214, :1341 — the provider's side.
	GatewayInternalServerError: "provider_down",
	GatewayFailedDependencyError: "provider_down",
	GatewayResponseError: "provider_down",
	// `@ai-sdk/provider@4.0.10`: a missing/blank key never reaches the network.
	AI_LoadAPIKeyError: "no_credit",
};

/**
 * Names that are WRAPPERS, consulted only after unwrapping found nothing.
 *
 * `AI_RetryError` is the trap: it carries `lastError` and `errors[]`, and the
 * decisive failure is in there. Classifying it eagerly reported "the provider is
 * down" for a run that actually ended on a 429 — caught by this file's own test
 * before the code shipped.
 */
const WRAPPER_NAMES: Readonly<Record<string, Exclude<AgentErrorClass, "ok">>> = {
	AI_RetryError: "provider_down",
};

/** Status codes, for providers whose errors are plain `APICallError`s (OpenRouter). */
function fromStatus(status: number): Exclude<AgentErrorClass, "ok"> | null {
	if (status === 429) return "rate_limited";
	if (status === 401 || status === 402 || status === 403) return "no_credit";
	if (status === 404) return "model_not_found";
	if (status >= 500) return "provider_down";
	return null;
}

/**
 * The ONE 400 that is not a caller bug.
 *
 * MEASURED 2026-09-06 03:5x against OpenRouter with the owner's key, model id
 * `does/not-exist-xyz`: `AI_APICallError`, `statusCode: 400`, message
 * "does/not-exist-xyz is not a valid model ID". OpenRouter answers 400, not 404,
 * for an unknown model, so a status-only rule would call a misconfiguration
 * "unknown" and send the operator hunting.
 *
 * Matched on the SHAPE of that sentence only, and only at status 400. Nothing
 * from the message is ever shown or logged.
 */
const MODEL_400 = /\bnot a valid model\b|\bmodel not found\b|\bno endpoints found\b|\bno allowed providers\b/i;

/** Network-level failures, which arrive as a TypeError or a system error code. */
const NETWORK_CODES: ReadonlySet<string> = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"ENOTFOUND",
	"ETIMEDOUT",
	"EAI_AGAIN",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_HEADERS_TIMEOUT",
	"UND_ERR_SOCKET",
]);

type ErrorLike = {
	name?: unknown;
	message?: unknown;
	statusCode?: unknown;
	status?: unknown;
	code?: unknown;
	cause?: unknown;
	lastError?: unknown;
	errors?: unknown;
};

/** One level of classification, with no unwrapping. */
function classifyOne(error: ErrorLike): Exclude<AgentErrorClass, "ok"> | null {
	const name = typeof error.name === "string" ? error.name : "";
	const named = NAMED[name];
	if (named !== undefined) return named;

	const status =
		typeof error.statusCode === "number"
			? error.statusCode
			: typeof error.status === "number"
				? error.status
				: null;
	const message = typeof error.message === "string" ? error.message : "";
	if (status !== null) {
		// The model check runs before the generic status rules: OpenRouter's
		// unknown-model answer is a 400, which would otherwise fall through.
		if (status === 400 && MODEL_400.test(message)) return "model_not_found";
		const byStatus = fromStatus(status);
		if (byStatus !== null) return byStatus;
	}

	if (typeof error.code === "string" && NETWORK_CODES.has(error.code)) return "provider_down";
	// `fetch` failures surface as a TypeError with no status at all.
	if (name === "TypeError" && /fetch|network/i.test(message)) return "provider_down";
	return null;
}

/**
 * The class of a thrown error, or `unknown`.
 *
 * Unwraps `cause`, `lastError` (the SDK's `RetryError`) and `errors[]`, because
 * the decisive error is routinely one layer down: `generateObject` wraps a parse
 * failure in `NoObjectGeneratedError`, and the retry wrapper hides the 429 that
 * ended the attempts. Depth-bounded so a self-referencing cause cannot spin.
 */
export function classifyAgentError(error: unknown, depth = 0): AgentErrorClass {
	if (depth > 6 || error === null || error === undefined) return "unknown";
	if (typeof error !== "object") return "unknown";

	const candidate = error as ErrorLike;
	const direct = classifyOne(candidate);
	if (direct !== null) return direct;

	for (const nested of [candidate.cause, candidate.lastError]) {
		if (nested === undefined || nested === null) continue;
		const found = classifyAgentError(nested, depth + 1);
		if (found !== "unknown") return found;
	}
	if (Array.isArray(candidate.errors)) {
		for (const nested of candidate.errors) {
			const found = classifyAgentError(nested, depth + 1);
			if (found !== "unknown") return found;
		}
	}

	const name = typeof candidate.name === "string" ? candidate.name : "";
	const wrapper = WRAPPER_NAMES[name];
	if (wrapper !== undefined) return wrapper;
	return "unknown";
}

/** The sentence for a thrown error. What `onError` returns to the browser. */
export function agentErrorSentence(error: unknown): string {
	const cls = classifyAgentError(error);
	return AGENT_ERROR_SENTENCES[cls === "ok" ? "unknown" : cls];
}

/**
 * What the browser shows for a failed turn.
 *
 * Two shapes reach `useChat`'s `error`, both measured in `ai@7.0.92`'s bytes:
 *
 *  - a STREAMED failure: the server's `onError` return value becomes
 *    `{type:"error", errorText}` (dist/index.js:7882-7886 for `streamText`'s
 *    own errors, :11381-11393 for a hand-written stream), the client turns that
 *    into `new Error(chunk.errorText)` (:7496), and the chat store rethrows and
 *    stores it (:19175). So `error.message` is exactly our sentence.
 *  - a NON-OK HTTP response (the gate's 503, the daily-limit 429): the transport
 *    throws `new Error(await response.text())` (:18673-18676), so `error.message`
 *    is the whole JSON body our route wrote.
 *
 * Neither is trusted blind. A JSON body is used only when it carries our own
 * `source: "agent"` marker, and a plain string only when it is one of the
 * sentences this app defines. Anything else — a proxy's error page, a provider
 * message that leaked upstream — falls back to the caller's generic line.
 */
export function agentErrorMessage(error: unknown, fallback: string): string {
	const raw =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: typeof (error as ErrorLike | null)?.message === "string"
					? ((error as ErrorLike).message as string)
					: "";
	const trimmed = raw.trim();
	if (trimmed === "") return fallback;

	if (trimmed.startsWith("{")) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (parsed !== null && typeof parsed === "object") {
				const body = parsed as { error?: unknown; source?: unknown };
				if (body.source === "agent" && typeof body.error === "string" && body.error.trim() !== "") {
					return body.error;
				}
			}
		} catch {
			// Not our JSON. Fall through to the allowlist, which will refuse it.
		}
		return fallback;
	}

	return KNOWN_SENTENCES.has(trimmed) ? trimmed : fallback;
}
