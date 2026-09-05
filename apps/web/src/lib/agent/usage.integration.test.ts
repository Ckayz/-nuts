/**
 * C6-r2 (lane C confirming pass, finding 6). The daily turn limit, against a
 * real `agent_usage` table.
 *
 * The reviewer injected model responses into the actual route and measured
 * `GUEST_TURNS { requested: 11, modelCalls: 11 }` and
 * `WALLET_TURNS { requested: 51, modelCalls: 51 }` — the table existed since
 * migration `0000_agent_tables` and nothing read or wrote it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@nuts/db";
import { agentUsage } from "@nuts/db/schema/index";
import { DAILY_TURNS } from "./limits";
import { chargeTurn, utcDay, type TurnSubject } from "./usage";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.log("agent usage integration skipped: DATABASE_URL is not set");
	test.skip("agent usage integration requires DATABASE_URL", () => {});
}
const describeLive = databaseUrl ? describe : describe.skip;

/** Unique per run, so a re-run never inherits a previous run's counter. */
const wallet = `0x${randomBytes(20).toString("hex")}`;
const ip = `203.0.113.${randomBytes(1)[0]}-${randomBytes(4).toString("hex")}`;
const subjects: TurnSubject[] = [
	{ kind: "wallet", subject: wallet },
	{ kind: "ip", subject: ip },
];

async function cleanup() {
	if (!databaseUrl) return;
	for (const subject of subjects) {
		await db
			.delete(agentUsage)
			.where(and(eq(agentUsage.subjectKind, subject.kind), eq(agentUsage.subject, subject.subject)));
	}
}

beforeAll(cleanup);
afterAll(cleanup);

describeLive("chargeTurn", () => {
	test("a wallet gets PRD 10.2's 50 turns and the 51st is refused", async () => {
		const subject = subjects[0] as TurnSubject;
		const results = [];
		for (let i = 0; i < DAILY_TURNS.wallet + 1; i++) results.push(await chargeTurn(subject));
		const allowed = results.filter((r) => r.allowed).length;
		expect(allowed).toBe(DAILY_TURNS.wallet);
		const last = results[results.length - 1];
		expect(last?.allowed).toBe(false);
		expect(last?.used).toBe(DAILY_TURNS.wallet + 1);
		expect(last?.limit).toBe(DAILY_TURNS.wallet);

		// One row, for today, holding the count. Nothing else was written.
		const rows = await db
			.select()
			.from(agentUsage)
			.where(and(eq(agentUsage.subjectKind, "wallet"), eq(agentUsage.subject, wallet)));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.day).toBe(utcDay());
		expect(rows[0]?.turns).toBe(DAILY_TURNS.wallet + 1);
	}, 60_000);

	test("a guest IP gets 10 and the 11th is refused", async () => {
		const subject = subjects[1] as TurnSubject;
		const results = [];
		for (let i = 0; i < DAILY_TURNS.guest + 1; i++) results.push(await chargeTurn(subject));
		expect(results.filter((r) => r.allowed).length).toBe(DAILY_TURNS.guest);
		expect(results[results.length - 1]?.allowed).toBe(false);
	}, 60_000);

	test("yesterday's count does not spend today's allowance", async () => {
		const subject = { kind: "ip", subject: `${ip}-day` } as const;
		const yesterday = new Date(Date.now() - 86_400_000);
		for (let i = 0; i < DAILY_TURNS.guest + 1; i++) await chargeTurn(subject, yesterday);
		const today = await chargeTurn(subject, new Date());
		expect(today.allowed).toBe(true);
		expect(today.used).toBe(1);
		await db
			.delete(agentUsage)
			.where(and(eq(agentUsage.subjectKind, "ip"), eq(agentUsage.subject, subject.subject)));
	}, 60_000);

	test("concurrent turns cannot both take the last allowance", async () => {
		const subject = { kind: "ip", subject: `${ip}-race` } as const;
		// Fill to one below the limit, then fire two at once.
		for (let i = 0; i < DAILY_TURNS.guest - 1; i++) await chargeTurn(subject);
		const [a, b] = await Promise.all([chargeTurn(subject), chargeTurn(subject)]);
		expect([a.allowed, b.allowed].filter(Boolean)).toHaveLength(1);
		expect([a.used, b.used].sort()).toEqual([DAILY_TURNS.guest, DAILY_TURNS.guest + 1]);
		await db
			.delete(agentUsage)
			.where(and(eq(agentUsage.subjectKind, "ip"), eq(agentUsage.subject, subject.subject)));
	}, 60_000);

	test("a caller with no wallet and no address is refused, and nothing is written", async () => {
		const result = await chargeTurn(null);
		expect(result.allowed).toBe(false);
		expect(result.used).toBe(0);
	});

	test("a database failure REFUSES the turn: the limiter never fails open", async () => {
		const broken = {
			execute: async () => {
				throw new Error("connection reset");
			},
		} as unknown as Parameters<typeof chargeTurn>[2];
		const result = await chargeTurn({ kind: "ip", subject: ip }, new Date(), broken);
		expect(result.allowed).toBe(false);
		if (result.allowed) throw new Error("unreachable");
		expect(result.reason).toContain("could not be checked");
	});
});
