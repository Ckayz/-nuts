import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { users } from "@nuts/db/schema/index";
import { writeProfile } from "./writes";

if (!process.env.DATABASE_URL) {
	test.skip("profile integration requires DATABASE_URL", () => {});
} else {
	const { db } = await import("@nuts/db");
	test("profile set/clear, session fence and duplicate handle", async () => {
		const rollback = new Error("rollback profile probe");
		try {
			await db.transaction(async tx => {
				const [a, b] = await tx.insert(users).values([
					{ walletAddress: `0x${crypto.randomUUID().replaceAll("-", "")}00000001` },
					{ walletAddress: `0x${crypto.randomUUID().replaceAll("-", "")}00000002` },
				]).returning();
				if (!a || !b) throw new Error("missing fixtures");
				const handle = `p_${a.id.replaceAll("-", "").slice(0, 28)}`;
				expect(await writeProfile(tx, null, { handle })).toEqual({ error: "sign_in_required" });
				expect(await writeProfile(tx, a.id, { handle: "bad-handle" })).toEqual({ error: "invalid_handle" });
				expect(await writeProfile(tx, a.id, { handle: handle.toUpperCase(), displayName: "Alice", bio: "Hello", userId: b.id })).toMatchObject({ profile: { handle, displayName: "Alice", bio: "Hello" } });
				const [other] = await tx.select().from(users).where(eq(users.id, b.id));
				expect(other?.handle).toBeNull();
				expect(await writeProfile(tx, a.id, { handle: "", displayName: "", bio: "" })).toMatchObject({ profile: { handle: null, displayName: null, bio: null } });
				await writeProfile(tx, a.id, { handle });
				// Duplicate is last: PostgreSQL aborts this transaction until rollback.
				expect(await writeProfile(tx, b.id, { handle })).toEqual({ error: "handle_taken" });
				throw rollback;
			});
		} catch (error) { if (error !== rollback) throw error; }
	});
}
