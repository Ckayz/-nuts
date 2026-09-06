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
import { agentErrorMessage } from "@/lib/agent/errors";
import {
	type Chip,
	chipsForTurn,
	isLinkChip,
	postFillSuggestions,
	postRfqSuggestions,
	splitSuggestionTrailer,
	starterSuggestions,
} from "@/lib/agent/suggestions";
import { AgentMarkdown } from "./agent-markdown";
import { RFQ_APPROVAL_TOOLS, RfqApproval } from "./rfq-approval";
import type { PreparedRfqAction, PreparedRfqCreate } from "./rfq-contract";
import { RfqActionExecution, RfqExecution } from "./rfq-execution";
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
	/**
	 * TODO-OWNER: what a failed turn says when the server did not say anything
	 * more specific. F-E: the server now usually does — `agentErrorMessage` picks
	 * its sentence when the failure carries one, and falls back to this line for
	 * anything the server did not write (a proxy error page, a dropped
	 * connection), so provider text can never reach the screen.
	 */
	error: "Something went wrong. Try sending that again.",
	/**
	 * TODO-OWNER: what the composer says while an approval card is unanswered.
	 *
	 * Follow-up 1 (`.research/rfq/followups.md`, measured in the 11:3x browser
	 * walk): sending a new message while a card was waiting failed the turn
	 * outright — the server logged `AI_MissingToolResultsError: Tool result is
	 * missing for tool call …` and the reader saw "The agent could not complete
	 * that." The runtime has suspended a tool call; it cannot take another
	 * message until that call is answered.
	 */
	awaitingApproval: "Answer the card above first.",
	/**
	 * TODO-OWNER: T-1 — what the MODEL is told when the user presses Cancel.
	 *
	 * Not a screen string: it is the `reason` the SDK attaches to the denial
	 * (`ai@7.0.92` dist/index.js:11733 hands the model `approval.reason` and
	 * falls back to a bare "Tool call execution denied."). With no reason the
	 * model had nothing to explain the refusal with and invented one — "the tool
	 * refused, likely because the order on the book has nearly expired" — about a
	 * book that had refused nothing.
	 */
	declined: "The user pressed Cancel in the chat. Nothing was prepared and nothing was sent.",
} as const;

/**
 * T-1. The answer handed to `addToolApprovalResponse`, for either card.
 *
 * A decline carries `reason`, so the model is told a PERSON stopped this rather
 * than being left with the SDK's anonymous "Tool call execution denied." An
 * approval carries none: there is nothing to explain, and an empty field would
 * still reach the model as a sentence.
 */
export function approvalAnswer(id: string, approved: boolean): { id: string; approved: boolean; reason?: string } {
	return approved ? { id, approved } : { id, approved, reason: COPY.declined };
}

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

/**
 * The follow-up row under a finished turn.
 *
 * Exported and dumb so a test can render it directly: the post-fill chips are
 * reachable only after a real recorded fill, which no unit test can produce.
 *
 * Two kinds of chip. A `send` chip puts its own text through the ordinary
 * input, so every guardrail runs on it as if it had been typed. A `href` chip
 * navigates instead — today only the composer, prefilled with the position.
 * `.pill` sets every property that governs the look (`index.css`), and the
 * global `a{color:inherit;text-decoration:none}` reset means an anchor needs
 * nothing extra to match the buttons beside it.
 */
export function SuggestionRow({
	chips,
	onSend,
}: {
	readonly chips: readonly Chip[];
	readonly onSend: (text: string) => void;
}) {
	/**
	 * D-6. The row is built from three independent sources — the post-fill
	 * chips, the post-RFQ chips and `chipsForTurn` — and two of them can name the
	 * same thing: `postFillSuggestions` always contains "Show my positions" and
	 * so does the signed-in fallback pool (`lib/agent/suggestions.ts`
	 * `walletChips`). Measured on the rotation, turn 5 rendered that button
	 * twice, under one duplicated React key.
	 *
	 * The FIRST of a repeated label wins: the deterministic chips lead the list
	 * because a fill is worth more than a follow-up question, and deduping here
	 * rather than at the call site keeps the rule true for every caller.
	 */
	const seen = new Set<string>();
	const unique = chips.filter((chip) => {
		if (seen.has(chip.label)) return false;
		seen.add(chip.label);
		return true;
	});
	if (unique.length === 0) return null;
	return (
		<div className="pills agent-suggest">
			{unique.map((chip, index) =>
				isLinkChip(chip) ? (
					// Keyed on the position as well as the label: the label is unique
					// after the filter above, and the index says so at a glance.
					<a key={`${index}.${chip.label}`} className="pill" href={chip.href}>
						{chip.label}
					</a>
				) : (
					<button
						type="button"
						key={`${index}.${chip.label}`}
						className="pill"
						onClick={() => onSend(chip.send)}
					>
						{chip.label}
					</button>
				),
			)}
		</div>
	);
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
	/**
	 * The position a fill in this conversation created, and the message that
	 * carried it. Client state: `TradeExecution` learns the id from the recording
	 * call, and nothing about it ever reaches the model — which is why the two
	 * chips it earns are deterministic rather than proposed in a trailer.
	 */
	const [lastFill, setLastFill] = useState<{ positionId: string; messageId: string } | null>(null);
	/**
	 * The RFQ this conversation created, cancelled or settled, and the message
	 * that carried it. Deterministic for the same reason `lastFill` is: the row id
	 * comes back from the recording call inside the card, never from a model turn.
	 */
	const [lastRfq, setLastRfq] = useState<{ rfqRequestId: string; messageId: string } | null>(null);
	const { address } = useAccount();

	// Read through a ref so the transport, created once, always sees the current
	// wallet. A transport rebuilt on every address change would drop the stream.
	const addressRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		addressRef.current = address;
	}, [address]);

	/**
	 * The same trick for the post and the market this panel is about.
	 *
	 * D-2: the dependency list read `[thesisId]`, so a client-side move from
	 * `/m/eth` to `/m/btc` — a PROP change with no remount, because
	 * `app/m/[asset]/page.tsx` renders this panel with no `key` and
	 * `components/market/right-tabs.tsx` keeps it mounted — left `assetRef` on
	 * the old market. The visible chips followed the prop (they read `asset`
	 * directly); the request body did not, so the model was told ETH while the
	 * reader was looking at BTC. Every value the effect writes belongs in its
	 * deps.
	 */
	const thesisRef = useRef<string | null>(thesisId);
	const assetRef = useRef<string | null>(asset);
	useEffect(() => {
		thesisRef.current = thesisId;
		assetRef.current = asset;
	}, [thesisId, asset]);

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

	/**
	 * The newest assistant turn is waiting on an approval card.
	 *
	 * `approvalRequest` is the SDK's own shape (`state: "approval-requested"` and
	 * an `approval.id`); once the user answers, the runtime moves that part to
	 * `approval-responded`, so "unanswered" needs no separate flag. While this
	 * holds, the runtime has a suspended tool call and cannot accept another
	 * message — see `COPY.awaitingApproval`.
	 */
	const last = messages[messages.length - 1];
	const awaitingApproval =
		last !== undefined &&
		last.role === "assistant" &&
		last.parts.some((part) => approvalRequest(part) !== null);

	/**
	 * How many assistant turns have been written, which is what makes the
	 * deterministic chip row move instead of repeating itself.
	 */
	const turn = messages.reduce((count, message) => (message.role === "assistant" ? count + 1 : count), 0);

	/**
	 * Is there a wallet the position tools would accept?
	 *
	 * MEASURED CAVEAT: this is "a wallet is CONNECTED", not "this browser holds a
	 * signed-in session" — the session is an httpOnly cookie the server reads,
	 * and the only client-side publisher of session state (`wallet-bar.tsx` →
	 * `connected-identity.ts`) publishes the connected address, not the session.
	 * The AUTHORITATIVE answer is the one the model gets: the route composes
	 * `sessionLine` from `getSession()`. This flag only decides whether the
	 * deterministic fallback row may offer a wallet-only chip, and a connected
	 * but unsigned visitor pressing one is told to sign in — the same sentence
	 * `getUserPositions` returns.
	 */
	const signedIn = Boolean(address);

	function submit(text: string) {
		const trimmed = text.trim();
		if (!trimmed || busy || awaitingApproval) return;
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
				{/*
				 * m3/m4 (Opus user-flow tester). `/m/<asset>` renders this component as a
				 * PANEL beside its own `<h1>{market.name}</h1>` (app/m/[asset]/page.tsx:256),
				 * so an `h1` here gave that page two — measured in a browser:
				 * `{"h1":["ETH","Agent"]}`. The embedded panel is a section of someone
				 * else's page and takes an `h2`; the full-page variant at `/agent` is the
				 * page, and keeps the only `h1` that route has (grepped: nothing else on
				 * `/agent` renders one).
				 */}
				{variant === "panel"
					? <h2 className="font-medium text-lg">Agent</h2>
					: <h1 className="font-medium text-lg">Agent</h1>}
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
						{/* Asset-aware where the panel is about one market: a starter
						    naming some other asset there is a worse prompt than one
						    naming the market on screen. */}
						<div className="pills">
							{starterSuggestions({ asset }).map((chip) => (
								<button
									type="button"
									key={chip.label}
									className="pill"
									onClick={() => submit(chip.send)}
									disabled={busy}
								>
									{chip.label}
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
								//
								// The reply's LAST line is the follow-up trailer the prompt asks
								// for (`SUGGEST: [...]`), which is chips, not prose: it is cut here
								// so it never renders. `state` is `TextUIPart.state`
								// (`ai@7.0.92` dist/index.d.ts:1870-1881, optional
								// "streaming" | "done"); it is treated as streaming while this
								// message is the one being written, because a part that never
								// carries the field would otherwise flash half a JSON array.
								// The person's own words sit in a panel so the page reads as
								// turns; the reply keeps the page background.
								//
								// D-7 (lane D). The trailer is a convention the MODEL is asked
								// to follow, and the cutter used to run on every text part —
								// including the user's. A message that merely CONTAINED a line
								// beginning `SUGGEST:` was silently truncated on screen:
								// measured, "What does this mean?\nSUGGEST: buy low sell high"
								// rendered as "What does this mean?". Nothing a person typed is
								// rewritten here.
								if (message.role === "user") {
									return (
										<div key={i} className="agent-user">
											<AgentMarkdown text={part.text} />
										</div>
									);
								}
								const streaming =
									part.state === "streaming" || (busy && message.id === messages[messages.length - 1]?.id);
								const { body } = splitSuggestionTrailer(part.text, streaming);
								return <AgentMarkdown key={i} text={body} />;
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
								// WHICH card answers is decided by the TOOL, read from the part
								// itself. `approvalRequest` keeps its measured shape (id + input)
								// — `agent-fold-r2.test.ts` pins that object exactly — so the tool
								// name is taken here rather than added to its answer.
								if (RFQ_APPROVAL_TOOLS.has(part.type)) {
									return (
										<RfqApproval
											key={i}
											tool={part.type}
											input={approval.input}
											pending={busy}
											onRespond={(approved) => addToolApprovalResponse(approvalAnswer(approval.id, approved))}
										/>
									);
								}
								return (
									<TradeApproval
										key={i}
										input={approval.input}
										pending={busy}
										onRespond={(approved) => addToolApprovalResponse(approvalAnswer(approval.id, approved))}
									/>
								);
							}

							// A prepared trade carries unsigned calldata for the user's wallet.
							if (part.type === "tool-requestOptionBookExecution") {
								const out = (part as { output?: unknown }).output as
									| (PreparedTrade & { prepared?: boolean })
									| undefined;
								if (out?.prepared === true) {
									return (
										<TradeExecution
											key={i}
											trade={out}
											// A confirmed fill is client state inside that component, not
											// a message part, so no model turn can propose what comes
											// next. The message id is remembered with it so the chips
											// disappear once the conversation moves on.
											onDone={(positionId) => setLastFill({ positionId, messageId: message.id })}
										/>
									);
								}
								return <ToolActivity key={i} part={part} />;
							}

							// A prepared RFQ carries unsigned calldata for the user's wallet,
							// exactly as a prepared trade does. `prepared === true` is the tool's
							// own flag; a refusal renders as ordinary tool activity.
							if (part.type === "tool-requestRfqCreation") {
								const out = (part as { output?: unknown }).output as
									| (PreparedRfqCreate & { prepared?: boolean })
									| undefined;
								if (out?.prepared === true) {
									return (
										<RfqExecution
											key={i}
											rfq={out}
											onDone={(rfqRequestId) => setLastRfq({ rfqRequestId, messageId: message.id })}
										/>
									);
								}
								return <ToolActivity key={i} part={part} />;
							}

							if (part.type === "tool-requestRfqCancellation" || part.type === "tool-requestRfqSettlement") {
								const out = (part as { output?: unknown }).output as
									| (PreparedRfqAction & { prepared?: boolean })
									| undefined;
								if (out?.prepared === true) {
									return (
										<RfqActionExecution
											key={i}
											action={out}
											onDone={(rfqRequestId) => setLastRfq({ rfqRequestId, messageId: message.id })}
										/>
									);
								}
								return <ToolActivity key={i} part={part} />;
							}

							if (part.type.startsWith("tool-")) {
								return <ToolActivity key={i} part={part} />;
							}
							return null;
						})}
					</article>
				))}

				{/* Follow-ups for the newest assistant turn only.
				    Owner 2026-09-06 05:4x: something to press on EVERY turn. First
				    choice is what the model itself proposed in its trailer; under it
				    sit the tool-derived chips (which can only name an instrument the
				    agent just saw) and a generic set, so a plain explanation or the
				    out-of-scope redirect is no longer a dead end. */}
				{(() => {
					// Hidden while a card is unanswered: pressing a chip would send a
					// message the runtime cannot accept (follow-up 1).
					if (busy || awaitingApproval) return null;
					if (last === undefined || last.role !== "assistant") return null;
					return (
						<SuggestionRow
							chips={[
								// A fill is worth more than a follow-up question, so it leads.
								...(lastFill !== null && lastFill.messageId === last.id
									? postFillSuggestions(lastFill.positionId)
									: []),
								// The same rule for a request the wallet just created, cancelled or
								// settled: no model turn produced it, so it cannot be proposed in a trailer.
								...(lastRfq !== null && lastRfq.messageId === last.id
									? postRfqSuggestions(lastRfq.rfqRequestId)
									: []),
								...chipsForTurn({ parts: last.parts as never, asset, turn, signedIn }),
							]}
							onSend={submit}
						/>
					);
				})()}

				{busy && <p className="text-muted-foreground text-sm">Thinking…</p>}
				{error && (
					<p className="agent-msg">
						{agentErrorMessage(error, COPY.error)} <TodoOwner />
					</p>
				)}
			</div>

			<div className="border-t py-4">
				{awaitingApproval && (
					<p className="agent-msg">
						{COPY.awaitingApproval} <TodoOwner />
					</p>
				)}
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
						placeholder={
							awaitingApproval
								? COPY.awaitingApproval
								: "Ask about a market, or describe what you think will happen…"
						}
						disabled={busy || awaitingApproval}
						rows={2}
					/>
					<InputGroupAddon align="block-end">
						<InputGroupButton
							onClick={() => submit(input)}
							disabled={busy || awaitingApproval || !input.trim()}
						>
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
