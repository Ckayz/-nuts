"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";

import { Button } from "@nuts/ui/components/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@nuts/ui/components/input-group";

import { ToolActivity } from "./tool-activity";

const STARTERS = [
	"What can I trade right now?",
	"I think ETH goes up this week. I have $10.",
	"What is a put, in plain words?",
	"Show me the simplest bet you have on BTC.",
];

export function AgentChat() {
	const [input, setInput] = useState("");
	const { messages, sendMessage, status, error } = useChat();

	const busy = status === "submitted" || status === "streaming";

	function submit(text: string) {
		const trimmed = text.trim();
		if (!trimmed || busy) return;
		void sendMessage({ text: trimmed });
		setInput("");
	}

	return (
		<div className="mx-auto flex h-[100dvh] w-full max-w-3xl flex-col px-4">
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
