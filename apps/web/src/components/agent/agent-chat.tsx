"use client";

import { useChat } from "@ai-sdk/react";
import {
	DefaultChatTransport,
	lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";

import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@nuts/ui/components/input-group";

import "@/styles/agent.css";
import { TodoOwner } from "@/components/primitives";
import { suggestionsFor } from "@/lib/agent/suggestions";
import { AgentMarkdown } from "./agent-markdown";
import { ToolActivity } from "./tool-activity";
import { TradeApproval } from "./trade-approval";
import { TradeExecution, type PreparedTrade } from "./trade-execution";

/**
 * D-N3 (lane D confirming pass). The sentences this component prints, in one
 * block so a new one cannot be added without a tag beside it — the same fence
 * `trade-execution.tsx` uses, and `copy.test.ts` now covers both.
 *
 * The mockup draws no agent view and the PRD sets no wording for one, so none
 * of this has provenance: every entry is provisional and the owner's to write.
 * A `TODO-OWNER` marker elsewhere in the file is not approval of these.
 */
const COPY = {
	/** TODO-OWNER: the one-line description under the "Agent" heading. */
	headerDescription: "Live Thetanuts liquidity on Base. It prepares trades; your wallet approves them.",
	/** TODO-OWNER: what an empty conversation invites the visitor to ask. */
	emptyDescription: "Ask about options, markets, or what a small budget could buy.",
	/** TODO-OWNER: what a failed turn says. Nothing here names the cause. */
	error: "Something went wrong. Try sending that again.",
} as const;

/**
 * D-C2. The four prompts offered on an empty conversation. Nobody's but this
 * file's: the mockup draws no agent view. TODO-OWNER: all four, and whether
 * there should be four at all.
 */
const STARTERS = [
	"What can I trade right now?",
	"I think ETH goes up this week. I have $10.",
	"What is a put, in plain words?",
	"Show me the simplest bet you have on BTC.",
];

/**
 * The opening message when the page was reached from a post's "Explain".
 *
 * It names the id and asks for the two things the owner asked for — what the
 * thesis says, and whether it can be traded — so the agent calls its own
 * `getThesisContext` tool. Nothing about the post is embedded here: the tool
 * reads it server-side, so a post the viewer may not see cannot leak through
 * the URL.
 *
 * TODO-OWNER: the wording of this opening message.
 */
function thesisOpener(thesisId: string): string {
	return `Explain the thesis with id ${thesisId}: what is it saying, and what would it take to trade the same view? If it names a structure, end with the link to its market page.`;
}

/**
 * C7-r2 (lane C confirming pass, finding 7). The body every chat request sends.
 *
 * `thesisId` was missing: the uuid appeared only inside the opening sentence,
 * the route bound `thesisId = null`, and a fill the agent prepared from
 * `/agent?thesis=<uuid>` was recorded as STANDALONE rather than as a
 * participant of that post. Exported and pure so the shape is pinned by a test
 * instead of by reading the transport's closure.
 */
export function chatRequestBody(input: {
	readonly messages: unknown;
	readonly body: unknown;
	readonly walletAddress: string | undefined;
	readonly thesisId: string | null;
	/** Optional so existing callers, and the tests pinning them, are unchanged. */
	readonly asset?: string | null;
}): Record<string, unknown> {
	return {
		...(input.body as Record<string, unknown> | undefined),
		messages: input.messages,
		walletAddress: input.walletAddress,
		// Omitted rather than sent as null: the route's schema marks it optional.
		...(input.thesisId === null ? {} : { thesisId: input.thesisId }),
		...(input.asset === null || input.asset === undefined ? {} : { asset: input.asset }),
	};
}

/**
 * Re-exported so `agent-fold-r2.test.ts` keeps importing it from here, which is
 * the pinned contract. The implementation moved to `./market-link` so the
 * markdown renderer can apply the same narrow rule without importing this file.
 */
export { marketLinkParts } from "./market-link";

/**
 * C1-r2. The approval a message part is waiting on, or null.
 *
 * Shaped from the SDK's own `UIToolInvocation` union (`ai@7.0.92`
 * `dist/index.d.ts`): a suspended tool call is `type: "tool-<name>"` with
 * `state: "approval-requested"` and a required `approval.id`. Nothing else in
 * that union carries `state: "approval-requested"`, and `approval.id` is the id
 * `addToolApprovalResponse` expects.
 *
 * Exported and pure so a test can feed it the part a real
 * `readUIMessageStream` produced, rather than a hand-written object.
 */
export function approvalRequest(part: unknown): { id: string; input: Record<string, unknown> | undefined } | null {
	if (part === null || typeof part !== "object") return null;
	const candidate = part as {
		type?: unknown;
		state?: unknown;
		input?: unknown;
		approval?: { id?: unknown };
	};
	if (typeof candidate.type !== "string" || !candidate.type.startsWith("tool-")) return null;
	if (candidate.state !== "approval-requested") return null;
	const id = candidate.approval?.id;
	if (typeof id !== "string" || id === "") return null;
	const input =
		candidate.input !== null && typeof candidate.input === "object"
			? (candidate.input as Record<string, unknown>)
			: undefined;
	return { id, input };
}

export function AgentChat({
	thesisId = null,
	asset = null,
	variant = "page",
}: {
	/** The post this conversation is about (`/agent?thesis=<uuid>`). */
	readonly thesisId?: string | null;
	/**
	 * The market this conversation is about. Defaults the agent's search; it does
	 * not stop the user asking about something else.
	 */
	readonly asset?: string | null;
	/**
	 * `page` fills the viewport under the header. `panel` sits inside a card in a
	 * column and caps its own height — the market page's right rail is one sticky
	 * stack, so a panel that grows without limit pushes the cards below it out of
	 * reach.
	 */
	readonly variant?: "page" | "panel";
}) {
	const [input, setInput] = useState("");
	const { address } = useAccount();

	// Read through a ref so the transport, created once, always sees the current
	// wallet. A transport rebuilt on every address change would drop the stream.
	const addressRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		addressRef.current = address;
	}, [address]);

	const thesisRef = useRef<string | null>(thesisId);
	const assetRef = useRef<string | null>(asset);
	useEffect(() => {
		thesisRef.current = thesisId;
		assetRef.current = asset;
	}, [thesisId]);

	const [transport] = useState(
		() =>
			new DefaultChatTransport({
				api: "/api/agent/chat",
				// Attaches the connected wallet to every request, including the turn the
				// runtime resumes automatically after an approval. The server binds it
				// into the write tool, so the model can never name a different address.
				//
				// C7-r2 (lane C confirming pass, finding 7). `thesisId` was NOT sent:
				// the uuid appeared only inside the opening sentence, so the route bound
				// `thesisId = null` and every fill the agent prepared from
				// `/agent?thesis=<uuid>` was recorded as STANDALONE instead of a
				// participant of that post. Read through the ref for the same reason the
				// address is: the transport is built once.
				prepareSendMessagesRequest: ({ messages, body }) => ({
					body: chatRequestBody({
						messages,
						body,
						walletAddress: addressRef.current,
						thesisId: thesisRef.current,
						asset: assetRef.current,
					}),
				}),
			}),
	);

	const { messages, sendMessage, status, error, addToolApprovalResponse } = useChat({
		transport,
		// Once the user answers an approval, resume the agent loop automatically
		// rather than making them send another message.
		sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
	});

	const busy = status === "submitted" || status === "streaming";

	// `/agent?thesis=<uuid>` opens the conversation with that post. The ref makes
	// it fire exactly once: React runs effects twice in development, and a second
	// send would ask the same question again on the user's bill.
	const openedFor = useRef<string | null>(null);
	useEffect(() => {
		if (thesisId === null || openedFor.current === thesisId) return;
		openedFor.current = thesisId;
		void sendMessage({ text: thesisOpener(thesisId) });
	}, [sendMessage, thesisId]);

	function submit(text: string) {
		const trimmed = text.trim();
		if (!trimmed || busy) return;
		void sendMessage({ text: trimmed });
		setInput("");
	}

	return (
		// F16: this used to be `h-[100dvh]`, the VIEWPORT height, while it renders
		// inside the shell's `<main class="wrap">` BELOW two sticky bars — so the
		// heading and the first messages sat underneath them and the page grew a
		// second scrollbar. The chrome above `<main>` is 126px, measured from
		// `src/index.css`: `.top` is 60px (line 74) and the nav sticks at
		// `top:60px` (line 97), which the file's own `.sticky{top:126px}` (line
		// 127) already states as the combined height. `min-h-0` keeps the message
		// list the only scrolling element.
		<div
			className={
				variant === "panel"
					? "agent-panel flex min-h-0 flex-col"
					: "mx-auto flex h-[calc(100dvh-126px)] min-h-0 w-full max-w-3xl flex-col px-4"
			}
		>
			<header className="border-b py-4">
				<h1 className="font-medium text-lg">Agent</h1>
				<p className="text-muted-foreground text-sm">
					{COPY.headerDescription} <TodoOwner />
				</p>
			</header>

			<div className="flex-1 space-y-6 overflow-y-auto py-6">
				{messages.length === 0 && (
					<div className="space-y-4">
						<p className="text-muted-foreground text-sm">
							{COPY.emptyDescription} <TodoOwner />
						</p>
						<div className="pills">
							{STARTERS.map((s) => (
								<button
									type="button"
									key={s}
									className="pill"
									onClick={() => submit(s)}
									disabled={busy}
								>
									{s}
								</button>
							))}
						</div>
					</div>
				)}

				{messages.map((message) => (
					<article key={message.id} className="space-y-2">
						<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
							{message.role === "user" ? "You" : "Agent"}
						</p>
						{message.parts.map((part, i) => {
							if (part.type === "text") {
								// Rendered as markdown: the model writes markdown because the system
								// prompt is written in markdown, and as plain text the asterisks showed.
								// AgentMarkdown applies marketLinkParts to every text node, so the
								// "only /m/ becomes a link" rule survives the change.
								return <AgentMarkdown key={i} text={part.text} />;
							}
							// The runtime suspended a write tool and is waiting for the user.
							//
							// C1-r2 (lane C confirming pass, BLOCKER 1). This branch used to
							// test `part.type === "tool-approval-request"`, which is the
							// name of the STREAM CHUNK, not of the UI part. `ai@7.0.92`
							// folds that chunk into the tool's own part:
							//
							//   {"type":"tool-requestOptionBookExecution",
							//    "state":"approval-requested",
							//    "input":{...},"approval":{"id":"a"}}
							//
							// (measured by feeding a real chunk through `readUIMessageStream`;
							// the SDK's `UIToolInvocation` union in `ai/dist/index.d.ts` has
							// the same four states). The test could therefore never be true,
							// the part fell through to `ToolActivity`, and Approve/Cancel
							// never rendered — so a normal agent turn stopped dead at the
							// approval it was waiting for.
							const approval = approvalRequest(part);
							if (approval !== null) {
								return (
									<TradeApproval
										key={i}
										input={approval.input}
										pending={busy}
										onRespond={(approved) =>
											addToolApprovalResponse({ id: approval.id, approved })
										}
									/>
								);
							}

							// A prepared trade carries unsigned calldata for the user's wallet.
							if (part.type === "tool-requestOptionBookExecution") {
								const out = (part as { output?: unknown }).output as
									| (PreparedTrade & { prepared?: boolean })
									| undefined;
								if (out?.prepared === true) return <TradeExecution key={i} trade={out} />;
								return <ToolActivity key={i} part={part} />;
							}

							if (part.type.startsWith("tool-")) {
								return <ToolActivity key={i} part={part} />;
							}
							return null;
						})}
					</article>
				))}

				{/* Follow-ups for the newest assistant turn only, derived in code from
				    the tool results that turn actually produced, so a chip can never
				    name an instrument the agent did not just see. */}
				{(() => {
					if (busy) return null;
					const last = messages[messages.length - 1];
					if (last === undefined || last.role !== "assistant") return null;
					const chips = suggestionsFor(last.parts as never);
					if (chips.length === 0) return null;
					return (
						<div className="pills agent-suggest">
							{chips.map((chip) => (
								<button
									type="button"
									key={chip.label}
									className="pill"
									onClick={() => submit(chip.send)}
								>
									{chip.label}
								</button>
							))}
						</div>
					);
				})()}

				{busy && <p className="text-muted-foreground text-sm">Thinking…</p>}
				{error && (
					<p className="agent-msg">
						{COPY.error} <TodoOwner />
					</p>
				)}
			</div>

			<div className="border-t py-4">
				<InputGroup>
					<InputGroupTextarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								submit(input);
							}
						}}
						// TODO-OWNER: placeholder wording.
						placeholder="Ask about a market, or describe what you think will happen…"
						disabled={busy}
						rows={2}
					/>
					<InputGroupAddon align="block-end">
						<InputGroupButton onClick={() => submit(input)} disabled={busy || !input.trim()}>
							Send
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
				<p className="mt-2 text-muted-foreground text-xs">
					Not financial advice. Agent-prepared trades are capped at $10 of risk.
				</p>
			</div>
		</div>
	);
}
