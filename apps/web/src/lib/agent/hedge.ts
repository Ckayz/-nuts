/**
 * Hedge-rule evaluation.
 *
 * Deliberately pure: no network, no chain, no database, no clock of its own.
 * Everything it needs is an argument, so the decision to spend a user's money
 * unattended can be tested exhaustively offline. The caller does the I/O.
 *
 * All money is decimal strings compared as scaled integers. A float comparison
 * here would move a trigger boundary, and a trigger boundary is the difference
 * between spending someone's money and not.
 */

/** Fixed comparison scale. Eight decimals matches the feed's price scale. */
const SCALE_DECIMALS = 8;
const SCALE = 10n ** BigInt(SCALE_DECIMALS);

/**
 * Decimal string to a scaled integer. Returns null rather than throwing or
 * coercing: a malformed stored value must skip its rule, never fire it.
 */
export function toScaled(value: string): bigint | null {
	if (!/^\d+(\.\d+)?$/.test(value)) return null;
	const [whole = "0", fraction = ""] = value.split(".");
	if (fraction.length > SCALE_DECIMALS) return null;
	return BigInt(whole) * SCALE + BigInt(fraction.padEnd(SCALE_DECIMALS, "0") || "0");
}

/** A number from the market feed to the same scale. */
export function spotToScaled(spot: number): bigint | null {
	if (!Number.isFinite(spot) || spot <= 0) return null;
	return toScaled(spot.toFixed(SCALE_DECIMALS));
}

export interface HedgeRule {
	readonly id: string;
	readonly walletAddress: string;
	readonly accountAddress: string;
	readonly asset: string;
	readonly floorUsd: string;
	readonly budgetPerTrigger: string;
	readonly dailyCapUsd: string;
	readonly status: "armed" | "paused" | "exhausted" | "revoked";
	readonly spentDay: string | null;
	readonly spentToday: string;
	readonly lastFiredAt: Date | null;
}

export type SkipReason =
	| "not_armed"
	| "no_spot_price"
	| "above_floor"
	| "daily_cap_reached"
	| "cooling_off"
	| "malformed_rule";

export interface Decision {
	readonly rule: HedgeRule;
	readonly fire: boolean;
	readonly reason: SkipReason | "floor_broken";
	/** Human sentence for the audit log and for the agent to repeat to the user. */
	readonly explanation: string;
	/** Present only when firing: what this trigger may spend, decimal string. */
	readonly budget?: string;
}

/**
 * Minimum gap between two fires of the same rule. Without it a rule whose floor
 * has broken fires on every tick until the daily cap is gone, which is a way to
 * lose money slowly rather than a hedge.
 *
 * TODO-OWNER: 6 hours is a placeholder. Product numbers are the owner's.
 */
export const COOLING_OFF_MS = 6 * 60 * 60 * 1000;

/** UTC calendar day, YYYY-MM-DD. Matches `agent_usage.day`. */
export function utcDay(now: Date): string {
	return now.toISOString().slice(0, 10);
}

/**
 * Spend already committed today. A rule whose `spentDay` is not today has its
 * counter treated as zero, which is how the daily cap resets without a job.
 */
export function spentTodayScaled(rule: HedgeRule, now: Date): bigint | null {
	if (rule.spentDay !== utcDay(now)) return 0n;
	return toScaled(rule.spentToday);
}

/**
 * Decide one rule. Every path returns a reason, including the ones that do
 * nothing, so the tick can log why it stayed still.
 */
export function evaluateRule(
	rule: HedgeRule,
	spotUsd: number | null | undefined,
	now: Date,
): Decision {
	const skip = (reason: SkipReason, explanation: string): Decision => ({
		rule,
		fire: false,
		reason,
		explanation,
	});

	if (rule.status !== "armed") {
		return skip("not_armed", `Rule is ${rule.status}, not armed.`);
	}

	const floor = toScaled(rule.floorUsd);
	const budget = toScaled(rule.budgetPerTrigger);
	const cap = toScaled(rule.dailyCapUsd);
	const spent = spentTodayScaled(rule, now);
	if (floor === null || budget === null || cap === null || spent === null) {
		return skip("malformed_rule", "Stored rule values could not be read as decimals.");
	}
	if (budget <= 0n) {
		return skip("malformed_rule", "Budget per trigger is not positive.");
	}

	if (spotUsd === null || spotUsd === undefined) {
		return skip("no_spot_price", `No spot price for ${rule.asset}; not acting on a guess.`);
	}
	const spot = spotToScaled(spotUsd);
	if (spot === null) {
		return skip("no_spot_price", `Spot price for ${rule.asset} is unusable.`);
	}

	if (spot > floor) {
		return skip(
			"above_floor",
			`${rule.asset} is above your ${rule.floorUsd} floor. Nothing to do.`,
		);
	}

	// Checked after the floor so the log distinguishes "did not trigger" from
	// "triggered but had no budget left" — they mean different things to a user.
	if (spent + budget > cap) {
		return skip(
			"daily_cap_reached",
			`${rule.asset} broke your ${rule.floorUsd} floor, but today's ${rule.dailyCapUsd} limit is spent.`,
		);
	}

	if (rule.lastFiredAt && now.getTime() - rule.lastFiredAt.getTime() < COOLING_OFF_MS) {
		return skip(
			"cooling_off",
			`Already hedged ${rule.asset} recently; waiting before doing it again.`,
		);
	}

	return {
		rule,
		fire: true,
		reason: "floor_broken",
		explanation: `${rule.asset} fell to ${spotUsd}, at or below your ${rule.floorUsd} floor. Buying downside protection with ${rule.budgetPerTrigger}.`,
		budget: rule.budgetPerTrigger,
	};
}

/** Evaluate every rule against one market snapshot. */
export function evaluateRules(
	rules: readonly HedgeRule[],
	spotByAsset: Readonly<Record<string, number>>,
	now: Date,
): Decision[] {
	return rules.map((rule) => evaluateRule(rule, spotByAsset[rule.asset], now));
}
