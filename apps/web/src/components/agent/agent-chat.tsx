"use client";

import { useChat } from "@ai-sdk/react";
import {
	DefaultChatTransport,
	lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";

import { Button } from "@nuts/ui/components/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@nuts/ui/components/input-group";

import { ToolActivity } from "./tool-activity";
import { TradeApproval } from "./trade-approval";
import { TradeExecution, type PreparedTrade } from "./trade-execution";

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

export function AgentChat({ thesisId = null }: { thesisId?: string | null }) {
	const [input, setInput] = useState("");
	const { address } = useAccount();

	// Read through a ref so the transport, created once, always sees the current
	// wallet. A transport rebuilt on every address change would drop the stream.
	const addressRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		addressRef.current = address;
	}, [address]);

	const thesisRef = useRef<string | null>(thesisId);
	useEffect(() => {
		thesisRef.current = thesisId;
	}, [thesisId]);

	const [transport] = useState(
		() =>
			new DefaultChatTransport({
				api: "/api/agent/chat",
				// Attaches the connected wallet to every request, including the turn the
				// runtime resumes automatically after an approval. The server binds it
				// into the write tool, so the model can never name a different address.
				prepareSendMessagesRequest: ({ messages, body }) => ({
					body: { ...body, messages, walletAddress: addressRef.current },
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
		<div className="mx-auto flex h-[calc(100dvh-126px)] min-h-0 w-full max-w-3xl flex-col px-4">
			<header className="border-b py-4">
				<h1 className="font-medium text-lg">Agent</h1>
				<p className="text-muted-foreground text-sm">
					Live Thetanuts liquidity on Base. It prepares trades; your wallet approves them.
				</p>
			</header>

			<div className="flex-1 space-y-6 overflow-y-auto py-6">
				{messages.length === 0 && (
					<div className="space-y-4">
						<p className="text-muted-foreground text-sm">
							Ask about options, markets, or what a small budget could buy.
						</p>
						<div className="flex flex-wrap gap-2">
							{STARTERS.map((s) => (
								<Button
									key={s}
									variant="outline"
									size="sm"
									onClick={() => submit(s)}
									disabled={busy}
								>
									{s}
								</Button>
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
								return (
									<p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
										{part.text}
									</p>
								);
							}
							// The runtime suspended a write tool and is waiting for the user.
							if (part.type === "tool-approval-request") {
								const req = part as unknown as {
									approvalId: string;
									toolCall?: { input?: { instrumentKey?: unknown; budget?: unknown } };
								};
								return (
									<TradeApproval
										key={i}
										input={req.toolCall?.input}
										pending={busy}
										onRespond={(approved) =>
											addToolApprovalResponse({ id: req.approvalId, approved })
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

				{busy && <p className="text-muted-foreground text-sm">Thinking…</p>}
				{error && (
					<p className="text-destructive text-sm">
						Something went wrong. Try sending that again.
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
