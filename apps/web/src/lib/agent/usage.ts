import "server-only";

/**
 * C6-r2 (lane C confirming pass, finding 6). The agent's daily turn limits.
 *
 * PRD 10.2, verbatim: "Default daily model limits are 10 turns per guest IP and
 * 50 per authenticated wallet." The `agent_usage` table has existed since
 * migration `0000_agent_tables` and NOTHING read or wrote it: the reviewer
 * injected model responses into the real route and measured
 * `GUEST_TURNS { requested: 11, modelCalls: 11 }` and
 * `WALLET_TURNS { requested: 51, modelCalls: 51 }`.
 *
 * A turn is counted BEFORE the model is called, in one atomic statement, so two
 * concurrent requests cannot both see the same count and both pass. The upsert
 * targets `agent_usage_subject_day_key`, which is exactly
 * `(subject_kind, subject, day)`.
 *
 * The day is the UTC calendar day, the same convention every other instant in
 * this app uses. TODO-OWNER: the reset boundary (UTC midnight) and the numbers
 * themselves are the PRD's; a per-user override is not implemented.
 *
 * A DATABASE FAILURE REFUSES THE TURN. PRD 14 asks for a spend control, and a
 * limiter that fails open is not one — the model call is what costs money.
 */
import { sql } from "drizzle-orm";
import { db } from "@nuts/db";
import { agentUsage } from "@nuts/db/schema/index";
import { DAILY_TURNS } from "./limits";

export type TurnSubject = { readonly kind: "wallet" | "ip"; readonly subject: string };

export type TurnResult =
	| { readonly allowed: true; readonly used: number; readonly limit: number }
	| { readonly allowed: false; readonly used: number; readonly limit: number; readonly reason: string };

/** UTC calendar day, `YYYY-MM-DD`, the shape `agent_usage.day` stores. */
export function utcDay(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/**
 * Who this turn is charged to.
 *
 * A signed-in wallet is charged as a wallet even when its IP is also known:
 * PRD 10.2 gives an authenticated wallet the higher allowance, and charging both
 * would let one person's browsing exhaust a shared IP's guest budget.
 *
 * Guests are charged to the client IP as the platform reports it. `x-forwarded-
 * for` is a list, left-most first; behind Vercel the left-most entry is the
 * client. It is spoofable by anyone who can reach the origin directly, which is
 * why it caps a MODEL BUDGET and nothing that moves money.
 * TODO-OWNER: whether guests get any allowance at all in production.
 */
export function subjectFor(walletAddress: string | null, headers: Headers): TurnSubject | null {
	if (walletAddress !== null && walletAddress !== "") {
		return { kind: "wallet", subject: walletAddress.toLowerCase() };
	}
	const forwarded = headers.get("x-forwarded-for");
	const first = forwarded?.split(",")[0]?.trim();
	const ip = first && first !== "" ? first : headers.get("x-real-ip")?.trim();
	if (!ip) return null;
	return { kind: "ip", subject: ip };
}

export function limitFor(kind: TurnSubject["kind"]): number {
	return kind === "wallet" ? DAILY_TURNS.wallet : DAILY_TURNS.guest;
}

/**
 * Charges one turn and says whether it was allowed.
 *
 * The whole decision is one statement: the row is inserted at 1 or incremented,
 * and the new value comes back. Reading first and then writing would let two
 * requests race past the last allowed turn.
 */
export async function chargeTurn(
	subject: TurnSubject | null,
	now: Date = new Date(),
	database: Pick<typeof db, "execute"> = db,
): Promise<TurnResult> {
	const limit = subject === null ? DAILY_TURNS.guest : limitFor(subject.kind);
	if (subject === null) {
		// No wallet and no client address: nothing can be counted, so nothing is
		// spent. TODO-OWNER: whether an unidentifiable caller should be served.
		return {
			allowed: false,
			used: 0,
			limit,
			reason: "This request carries no wallet and no client address, so its daily allowance cannot be counted.",
		};
	}
	const day = utcDay(now);
	let used: number;
	try {
		const rows = await database.execute<{ turns: number }>(sql`
			insert into ${agentUsage} (subject_kind, subject, day, turns, updated_at)
			values (${subject.kind}, ${subject.subject}, ${day}, 1, now())
			on conflict (subject_kind, subject, day)
			do update set turns = ${agentUsage.turns} + 1, updated_at = now()
			returning turns
		`);
		const row = "rows" in rows ? rows.rows[0] : (rows as unknown as { turns: number }[])[0];
		if (!row) throw new Error("agent_usage upsert returned no row");
		used = Number(row.turns);
	} catch (error) {
		console.error("[agent/usage] could not charge a turn:", error);
		return {
			allowed: false,
			used: 0,
			limit,
			reason: "The daily agent allowance could not be checked, so this turn was not started. Try again shortly.",
		};
	}
	if (used > limit) {
		return {
			allowed: false,
			used,
			limit,
			// TODO-OWNER: wording, and whether to name the reset time.
			reason:
				subject.kind === "wallet"
					? `You have used today's ${limit} agent turns. The allowance resets at 00:00 UTC.`
					: `This connection has used today's ${limit} agent turns. Sign in with a wallet for more; the allowance resets at 00:00 UTC.`,
		};
	}
	return { allowed: true, used, limit };
}
