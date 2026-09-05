/**
 * Does a database carry EXACTLY this tree's migrations?
 *
 * `scripts/verify.ts` fence 3 asks that question before it lets any live suite
 * run. Until the one-shot review (2026-09-06, lane A finding A-C4) it only asked
 * half of it: it exited 1 on a MISSING hash and merely LOGGED extras, so a
 * database migrated from a different tree — the parked `agent_hedge_rules`
 * branch's `0009`, say, or a second developer's experiment — passed a fence
 * whose stated contract is "exactly this tree's migrations". Duplicates passed
 * too. Measured in memory by the reviewer:
 *
 *     exact:     exit 0 — 2 migrations applied
 *     missing:   exit 1 — 1 migration(s) not applied: B
 *     wrong:     exit 1 — 1 migration(s) not applied: B
 *     extra:     exit 0 — 2 migrations applied (+1 unknown to this tree)   ← hole
 *     duplicate: exit 0 — 2 migrations applied (+1 unknown to this tree)   ← hole
 *
 * `drizzle.__drizzle_migrations.hash` is the SHA-256 of the migration's `.sql`
 * bytes — measured against `0000_agent_tables.sql` and
 * `0007_standalone_positions.sql` on 2026-09-05 — so comparing hashes catches a
 * database migrated from a DIFFERENT tree, which a count alone would pass.
 *
 * No imports: this module is loaded by a `bun -e` probe running in an arbitrary
 * cwd, and by a test.
 */

/** One journal entry: the migration's tag and the SHA-256 of its `.sql` bytes. */
export interface ExpectedMigration {
	tag: string;
	hash: string;
}

/**
 * Every way `applied` differs from `expected`, as printable lines. Empty means
 * the database carries exactly this tree's chain.
 *
 * Order of `applied` is not compared: drizzle applies journal entries in order
 * and the id column already carries it, and a reordering cannot happen without
 * also changing the set.
 */
export function migrationMismatches(expected: readonly ExpectedMigration[], applied: readonly string[]): string[] {
	const problems: string[] = [];

	const appliedSet = new Set(applied);
	const missing = expected.filter((entry) => !appliedSet.has(entry.hash));
	if (missing.length > 0) {
		problems.push(`${missing.length} migration(s) not applied: ${missing.map((entry) => entry.tag).join(", ")}`);
	}

	const seen = new Set<string>();
	const duplicated = new Set<string>();
	for (const hash of applied) {
		if (seen.has(hash)) duplicated.add(hash);
		seen.add(hash);
	}
	if (duplicated.size > 0) {
		problems.push(
			`${duplicated.size} migration hash(es) recorded more than once: ${[...duplicated].sort().join(", ")}`,
		);
	}

	const expectedSet = new Set(expected.map((entry) => entry.hash));
	const extra = [...new Set(applied)].filter((hash) => !expectedSet.has(hash));
	if (extra.length > 0) {
		problems.push(`${extra.length} applied migration(s) unknown to this tree: ${extra.sort().join(", ")}`);
	}

	return problems;
}
