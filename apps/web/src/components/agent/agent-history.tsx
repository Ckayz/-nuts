import Link from "next/link";

import { TodoOwner } from "@/components/primitives";

/**
 * W5. The signed-in wallet's saved chats, above the agent on `/agent`.
 *
 * Owner ask 2026-09-06 15:0x, verbatim: "can you add in like history for the ai
 * agent for every session ?"
 *
 * Presentational and server-rendered: the page reads the list through
 * `lib/agent/history.ts` and hands it over, so nothing here touches a session,
 * a database or a fetch. That is also what makes it testable without a browser.
 *
 * DESIGN. `.pills`/`.pill` — the ticket's own chip row, which is what the agent
 * surface already uses for its follow-ups (`.agent-suggest`). No accent (the
 * accent's list is closed: primary buttons, the active tab underline, the
 * selected side, the share-card frame, the "Open" chip, focus rings), no
 * colour, hairlines only, and the row wraps on a narrow screen because `.pills`
 * is `flex-wrap:wrap`.
 */
export interface HistoryEntry {
	readonly id: string;
	readonly title: string | null;
	readonly updatedAt: Date;
}

/**
 * Every sentence and label this component prints, in ONE block, each documented
 * as the owner's — the same fence `agent-chat.tsx` and `trade-execution.tsx`
 * carry, and `copy.test.ts` covers this block too. The mockup draws no agent
 * view at all, so none of this has provenance.
 */
export const HISTORY_COPY = {
	/** TODO-OWNER: what this row of saved chats is called. */
	heading: "Your chats",
	/** TODO-OWNER: the label on the link that starts a fresh conversation. */
	newChat: "New chat",
	/**
	 * TODO-OWNER: what a signed-out visitor is told. PRD 10.2 sets the RULE
	 * ("Wallet authentication is required for persistence"), not the wording.
	 */
	signedOut: "Sign in with a wallet to keep your chats.",
	/** TODO-OWNER: what a signed-in wallet with no saved chats yet is told. */
	empty: "Chats you have here are saved to your wallet.",
	/** TODO-OWNER: a conversation whose first message carried no text to title it with. */
	untitled: "Untitled chat",
} as const;

/**
 * How long ago, in the shortest honest unit.
 *
 * Its own function rather than `Intl.RelativeTimeFormat` because the label sits
 * inside a chip beside a title and has to stay two or three characters wide.
 * Pure and exported so a test can pin it without rendering anything.
 *
 * TODO-OWNER: the wording of these units.
 */
export function shortAgo(updatedAt: Date, now: Date): string {
	const seconds = Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / 1000));
	if (seconds < 60) return "now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}

export function AgentHistory({
	conversations,
	activeId = null,
	signedIn,
	now = new Date(),
}: {
	readonly conversations: readonly HistoryEntry[];
	/** The conversation currently open, so its chip reads as selected. */
	readonly activeId?: string | null;
	/**
	 * Whether the SERVER saw a session. Not "a wallet is connected": persistence
	 * is the session's, and the page that renders this read the cookie.
	 */
	readonly signedIn: boolean;
	/** Injected so the relative labels are deterministic in a test. */
	readonly now?: Date;
}) {
	if (!signedIn) {
		return (
			<section className="border-b py-3" aria-label={HISTORY_COPY.heading}>
				<p className="text-muted-foreground text-xs">
					{HISTORY_COPY.signedOut} <TodoOwner />
				</p>
			</section>
		);
	}
	return (
		<section className="space-y-2 border-b py-3" aria-label={HISTORY_COPY.heading}>
			<div className="pills">
				{/* Always first, and always a link to the bare route: a new chat is a
				    conversation that does not exist yet, so there is no id to send. */}
				<Link className="pill" href="/agent">
					{HISTORY_COPY.newChat}
				</Link>
				{conversations.map((conversation) => (
					<Link
						className="pill"
						key={conversation.id}
						href={`/agent?c=${conversation.id}`}
						aria-current={conversation.id === activeId ? "page" : undefined}
						// `.pill.on` is the selected look the tab rows use; `aria-current`
						// is what a screen reader reads.
						{...(conversation.id === activeId ? { "aria-selected": true } : {})}
					>
						<span>{conversation.title === null || conversation.title === "" ? HISTORY_COPY.untitled : conversation.title}</span>
						<span className="text-muted-foreground">{shortAgo(conversation.updatedAt, now)}</span>
					</Link>
				))}
			</div>
			{conversations.length === 0 && (
				<p className="text-muted-foreground text-xs">
					{HISTORY_COPY.empty} <TodoOwner />
				</p>
			)}
		</section>
	);
}
