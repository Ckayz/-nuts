import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletAddress: text("wallet_address").notNull(),
    nonce: text("nonce").notNull(),
    domain: text("domain").notNull(),
    chainId: integer("chain_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("auth_challenges_nonce_unique").on(table.nonce),
    check("auth_challenges_wallet_address_lowercase", sql`${table.walletAddress} = lower(${table.walletAddress})`),
  ],
);

export type AuthChallenge = typeof authChallenges.$inferSelect;
export type NewAuthChallenge = typeof authChallenges.$inferInsert;
