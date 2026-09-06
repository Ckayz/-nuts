/// <reference types="bun" />
/**
 * W5. An approval card in a REOPENED conversation.
 *
 * A saved chat can end on an assistant message whose part is
 * `state: "approval-requested"` — that is what the server produced, and it is
 * stored as produced. The runtime that suspended the tool call died with the
 * request that made it, so `approval.id` names nothing that is waiting: the
 * buttons would answer an approval nobody is holding. The card is printed
 * without them, and `addToolApprovalResponse` is never called for it.
 *
 * WHY A SUBPROCESS. `agent-suggest.test.tsx` already replaces `@ai-sdk/react`
 * with `mock.module`, which is process-wide in bun; a second, different
 * replacement here would silently change that file's behaviour too. Each case
 * therefore renders in its own child with the stubs installed as bun plugins,
 * the same shape `page-data.wiring.test.ts` and `history.route.test.ts` use.
 */
import { expect, test } from "bun:test";

const REOPENED_ID = "reopened-assistant-1";
const LIVE_ID = "live-assistant-1";

/**
 * One `approval-requested` part, exactly as `ai@7.0.92` folds the
 * `tool-approval-request` chunk into the tool's own part — the shape
 * `approvalRequest()` in `agent-chat.tsx` is written against.
 */
const APPROVAL_PART = {
	type: "tool-requestOptionBookExecution",
	toolCallId: "call-1",
	state: "approval-requested",
	input: { instrumentKey: "ETH|put|2340", budget: "5" },
	approval: { id: "approval-1" },
};

/** Renders `<AgentChat>` in a child and returns the markup plus what it called. */
function render(options: { readonly reopened: boolean }): { html: string; responded: number } {
	const script = `
		import { plugin } from "bun";

		const APPROVAL_PART = ${JSON.stringify(APPROVAL_PART)};
		const REOPENED_ID = ${JSON.stringify(REOPENED_ID)};
		const LIVE_ID = ${JSON.stringify(LIVE_ID)};
		const REOPENED = ${options.reopened};

		// The message the chat is showing. When REOPENED it is handed to the
		// component as \`initialMessages\` AS WELL, which is the only difference
		// between the two cases.
		const message = {
			id: REOPENED ? REOPENED_ID : LIVE_ID,
			role: "assistant",
			parts: [APPROVAL_PART],
		};

		globalThis.__responded = 0;
		plugin({ name: "expired-approval-probe", setup(build) {
			build.module("server-only", () => ({ exports: {}, loader: "object" }));
			build.module("@/styles/agent.css", () => ({ exports: {}, loader: "object" }));
			// \`useChat\` needs a live fetch to do anything, so the whole hook is
			// replaced — the same reason \`agent-suggest.test.tsx\` replaces it.
			build.module("@ai-sdk/react", () => ({ exports: {
				useChat: () => ({
					messages: [message],
					sendMessage: () => {},
					status: "ready",
					error: undefined,
					// The assertion that matters: this must never be reached for a
					// reopened card.
					addToolApprovalResponse: () => { globalThis.__responded += 1; },
				}),
			}, loader: "object" }));
			// Every wagmi hook the agent components reach for (grepped), stubbed to
			// a disconnected browser. None of them is exercised by these two cases:
			// a card that renders no buttons cannot send anything, and the live case
			// is never clicked.
			build.module("wagmi", () => ({ exports: {
				useAccount: () => ({ address: undefined }),
				useConfig: () => ({}),
				useConnection: () => ({}),
				useSendTransaction: () => ({ sendTransactionAsync: async () => { throw new Error("no wallet in this probe"); } }),
				useSwitchChain: () => ({ switchChainAsync: async () => { throw new Error("no wallet in this probe"); } }),
			}, loader: "object" }));
			build.module("wagmi/actions", () => ({ exports: {
				waitForTransactionReceipt: async () => { throw new Error("no chain in this probe"); },
			}, loader: "object" }));
		}});

		const { createElement } = await import("react");
		const { renderToStaticMarkup } = await import("react-dom/server");
		const { AgentChat } = await import("@/components/agent/agent-chat");

		const html = renderToStaticMarkup(
			createElement(AgentChat, REOPENED
				? { initialMessages: [message], initialConversationId: "11111111-1111-4111-8111-111111111111" }
				: {}),
		);
		console.log("RESULT:" + JSON.stringify({ html, responded: globalThis.__responded }));
	`;
	const child = Bun.spawnSync([process.execPath, "-e", script], {
		cwd: new URL("../../..", import.meta.url).pathname,
		env: {
			...process.env,
			DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://localhost/offline",
			OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "offline-test",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = child.stdout.toString();
	if (child.exitCode !== 0) throw new Error(`${child.stderr.toString()}\n${out}`);
	const line = out.split("\n").find((part) => part.startsWith("RESULT:"));
	if (line === undefined) throw new Error(`no result:\n${out}\n${child.stderr.toString()}`);
	return JSON.parse(line.slice("RESULT:".length)) as { html: string; responded: number };
}

const EXPIRED = "This request expired when the chat was closed. Ask again to prepare it.";

test("a reopened approval card prints the expired sentence and no buttons", () => {
	const { html, responded } = render({ reopened: true });
	expect(html).toContain(EXPIRED);
	// The two controls a live card carries are gone.
	expect(html).not.toContain(">Approve<");
	expect(html).not.toContain(">Cancel<");
	expect(html).not.toContain("Prepare this trade?");
	// Nothing on the page can answer it, so nothing did.
	expect(responded).toBe(0);
	// The frame is the same object it was: the card, not a bare sentence.
	expect(html).toContain('class="rounded-lg border p-4"');
	// And the composer is not locked — `awaitingApproval` ignores reopened
	// messages, or the person could open their own saved chat and not type in it.
	expect(html).not.toContain("Answer the card above first.");
}, 60_000);

test("a live approval card in the same component still shows Approve and Cancel", () => {
	const { html } = render({ reopened: false });
	expect(html).toContain(">Approve<");
	expect(html).toContain(">Cancel<");
	expect(html).toContain("Prepare this trade?");
	expect(html).not.toContain(EXPIRED);
	// The live one DOES lock the composer, which is the pre-existing rule.
	expect(html).toContain("Answer the card above first.");
}, 60_000);
