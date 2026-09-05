import { describe, expect, test } from "bun:test";
import { Client } from "pg";
import { canonicalFillEvent } from "./fixtures/fill-event";

const databaseUrl = process.env.DATABASE_URL;
import { seed, u1, u2, t1, t2, p1 } from "./fixtures/schema";

// A connection and rolled-back transaction per test: no shared mutable fixture.
function probe(name: string, run: (client: Client) => Promise<void>) {
  test(name, async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      await seed(client);
      await run(client);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
}

async function rejects(client: Client, sql: string, params: unknown[], expected: { code: string; constraint?: string; message?: string }) {
  await client.query("SAVEPOINT rejection");
  let caught: unknown;
  try {
    await client.query(sql, params);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } catch (error) { caught = error; }
  await client.query("ROLLBACK TO SAVEPOINT rejection");
  await client.query("RELEASE SAVEPOINT rejection");
  expect(caught).toMatchObject(expected);
}
const check = (constraint: string) => ({ code: "23514", constraint });
async function publish(client: Client) {
  await client.query("UPDATE public.theses SET creator_position_id=$1,status='open' WHERE id=$2", [p1, t1]);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  await client.query("SET CONSTRAINTS ALL DEFERRED");
}

if (!databaseUrl) {
  console.log("schema integration skipped: DATABASE_URL is not set");
  test.skip("migrated schema constraints require DATABASE_URL", () => {});
} else describe("migrated schema constraints", () => {
  for (const headline of ["", "   ", "\n\t"]) {
    probe(`headline rejects ${JSON.stringify(headline)} on insert and update`, async (client) => {
      await rejects(client, "INSERT INTO public.theses(creator_user_id,headline,status) VALUES ($1,$2,'open')", [u1, headline], check("theses_headline_nonblank"));
      await rejects(client, "UPDATE public.theses SET headline=$1 WHERE id=$2", [headline, t1], check("theses_headline_nonblank"));
    });
  }
  probe("normal headline accepted", async (client) => {
    const result = await client.query("INSERT INTO public.theses(creator_user_id,headline,status) VALUES ($1,'A normal headline','open') RETURNING headline", [u1]);
    expect(result.rows).toEqual([{ headline: "A normal headline" }]);
  });

  async function backfillLinkedDraft(client: Client) {
    // Recreate the pre-0003 tag state within the rolled-back test transaction.
    await client.query('ALTER TABLE public.theses DROP CONSTRAINT theses_tagged_asset_matches_structure');
    await client.query("UPDATE public.theses SET tagged_asset=NULL,creator_position_id=$1 WHERE id=$2", [p1, t1]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("UPDATE public.users SET wallet_address='0xaaa' WHERE id=$1", [u1]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    expect((await client.query("SELECT t.status,t.tagged_asset,p.status AS position_status,p.wallet_address AS position_wallet,u.wallet_address AS creator_wallet FROM public.theses t JOIN public.positions p ON p.id=t.creator_position_id JOIN public.users u ON u.id=t.creator_user_id WHERE t.id=$1", [t1])).rows).toEqual([{ status: "draft", tagged_asset: null, position_status: "confirmed", position_wallet: "0xabc", creator_wallet: "0xaaa" }]);
    const migration = await Bun.file(new URL("../src/migrations/0003_thesis_is_a_post.sql", import.meta.url)).text();
    const start = migration.indexOf('ALTER TABLE "theses" DISABLE TRIGGER "theses_creator_position_invariant";');
    const endStatement = 'ALTER TABLE "theses" ENABLE TRIGGER "theses_creator_position_invariant";';
    const end = migration.indexOf(endStatement, start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    // Execute the exact statements from the migration, including its WHERE clause.
    for (const statement of migration.slice(start, end + endStatement.length).split("--> statement-breakpoint")) {
      await client.query(statement);
    }
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    expect((await client.query("SELECT tagged_asset FROM public.theses WHERE id=$1", [t1])).rows).toEqual([{ tagged_asset: "ETH" }]);
  }
  probe("tag backfill preserves round-6 linked draft after creator wallet change", backfillLinkedDraft);
  probe("tag backfill restores creator position trigger enforcement", async (client) => {
    await backfillLinkedDraft(client);
    await rejects(client, "UPDATE public.theses SET creator_position_id=$1 WHERE id=$2", [p1, t1], { code: "23514", message: `invalid creator position for thesis ${t1}` });
  });

  const quantities = ["budget", "contracts", "premium", "fees", "collateral", "maximum_loss", "maximum_payout", "settlement_price", "payout", "estimated_pnl", "final_pnl"];
  const nullableQuantities = ["maximum_loss", "maximum_payout", "estimated_pnl", "settlement_price", "payout", "final_pnl"];
  for (const column of quantities) {
    const constraint = `positions_${column}_integral${["estimated_pnl", "final_pnl"].includes(column) ? "" : "_nonnegative"}`;
    probe(constraint + " rejects fraction", async (client) => {
      const decimals = nullableQuantities.includes(column) ? `, ${column}_decimals=6` : "";
      await rejects(client, `UPDATE public.positions SET ${column}=1.5${decimals} WHERE id=$1`, [p1], check(constraint));
    });
    if (!["estimated_pnl", "final_pnl"].includes(column)) probe(constraint + " rejects negative", async (client) => {
      const decimals = nullableQuantities.includes(column) ? `, ${column}_decimals=6` : "";
      await rejects(client, `UPDATE public.positions SET ${column}=-1${decimals} WHERE id=$1`, [p1], check(constraint));
    });
  }
  probe("contracts reject zero", async (client) => {
    await rejects(client, "UPDATE public.positions SET contracts=0 WHERE id=$1", [p1], check("positions_contracts_integral_nonnegative"));
  });
  for (const [table, column, id] of [["positions", "break_even_prices", p1], ["theses", "strikes", t1]]) {
    for (const [name, value] of [["fraction", "ARRAY[1.5]"], ["negative", "ARRAY[-1]"], ["null element", "ARRAY[1,NULL,2]"], ["2-D array", "ARRAY[[1],[2]]"]]) {
      probe(`${table}_${column} rejects ${name}`, async (client) => {
        await rejects(client, `UPDATE public.${table} SET ${column}=${value}::numeric[] WHERE id=$1`, [id], check(`${table}_${column}_integral_nonnegative`));
      });
    }
  }
  probe("theses_strikes reject empty array", async (client) => {
    await rejects(client, "UPDATE public.theses SET strikes=ARRAY[]::numeric[] WHERE id=$1", [t1], check("theses_strikes_integral_nonnegative"));
  });
  const positionDecimals = ["budget_decimals", "contract_decimals", "premium_decimals", "fee_decimals", "collateral_decimals", "maximum_loss_decimals", "maximum_payout_decimals", "break_even_price_decimals", "estimated_pnl_decimals", "settlement_price_decimals", "payout_decimals", "final_pnl_decimals"];
  for (const [table, columns, id] of [["positions", positionDecimals, p1], ["theses", ["strike_decimals", "collateral_decimals"], t1]] as const) {
    for (const column of columns) probe(`${table}_${column} rejects negative decimals`, async (client) => {
      await rejects(client, `UPDATE public.${table} SET ${column}=-1 WHERE id=$1`, [id], check(`${table}_${column}_nonnegative`));
    });
  }
  for (const column of nullableQuantities) probe(`${column} requires decimals when non-null`, async (client) => {
    await rejects(client, `UPDATE public.positions SET ${column}=1,${column}_decimals=NULL WHERE id=$1`, [p1], check(`positions_${column}_decimals_required`));
  });
  probe("valid quantity boundaries and empty break-even array remain accepted", async (client) => {
    await client.query("UPDATE public.positions SET budget=0,premium=0,fees=0,collateral=0,estimated_pnl=-1,estimated_pnl_decimals=0,final_pnl=-1,final_pnl_decimals=0,break_even_prices=ARRAY[]::numeric[] WHERE id=$1", [p1]);
  });

  probe("users_wallet_address_unique", async (client) => {
    await rejects(client, "INSERT INTO public.users(wallet_address) VALUES ('0xabc')", [], { code: "23505", constraint: "users_wallet_address_unique" });
  });
  probe("auth_challenges_nonce_unique", async (client) => {
    await rejects(client, "INSERT INTO public.auth_challenges(wallet_address,nonce,domain,chain_id,expires_at) VALUES ('0xdef','nonce-1','test',8453,now())", [], { code: "23505", constraint: "auth_challenges_nonce_unique" });
  });
  probe("positions_chain_id_tx_hash_unique", async (client) => {
    await rejects(client, "INSERT INTO public.positions(thesis_id,user_id,role,side,status,chain_id,wallet_address,order_id,order_snapshot,fill_event,tx_hash,budget,budget_decimals,contracts,contract_decimals,premium,premium_decimals,fees,fee_decimals,collateral,collateral_decimals,break_even_prices,break_even_price_decimals,break_even_prices_usd,confirmed_at) SELECT thesis_id,user_id,role,side,status,chain_id,wallet_address,order_id,order_snapshot,fill_event,tx_hash,budget,budget_decimals,contracts,contract_decimals,premium,premium_decimals,fees,fee_decimals,collateral,collateral_decimals,break_even_prices,break_even_price_decimals,break_even_prices_usd,confirmed_at FROM public.positions WHERE id=$1", [p1], { code: "23505", constraint: "positions_chain_id_tx_hash_unique" });
  });
  probe("theses_creator_position_unique in isolation from deferred relationship trigger", async (client) => {
    await publish(client);
    // The unique index is immediate; the relationship trigger is still deferred.
    await rejects(client, "UPDATE public.theses SET creator_position_id=$1 WHERE id=$2", [p1, t2], { code: "23505", constraint: "theses_creator_position_unique" });
  });
  for (const table of ["users", "auth_challenges", "positions"]) probe(`${table}_wallet_address_lowercase`, async (client) => {
    await rejects(client, `UPDATE public.${table} SET wallet_address='0xABC' WHERE wallet_address='0xabc'`, [], check(`${table}_wallet_address_lowercase`));
  });
  for (const table of ["positions", "auth_challenges"]) probe(`${table}_base_chain`, async (client) => {
    await rejects(client, `UPDATE public.${table} SET chain_id=1`, [], check(`${table}_base_chain`));
  });
  probe("open unbacked structured thesis accepted", async (client) => {
    await client.query("UPDATE public.theses SET status='open' WHERE id=$1", [t1]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    expect((await client.query("SELECT status,creator_position_id FROM public.theses WHERE id=$1", [t1])).rows).toEqual([{ status: "open", creator_position_id: null }]);
  });
  probe("text-only published insert accepted", async (client) => {
    const result = await client.query("INSERT INTO public.theses(creator_user_id,headline,status) VALUES ($1,'h','open') RETURNING direction,strikes,creator_position_id", [u1]);
    expect(result.rows).toEqual([{ direction: null, strikes: null, creator_position_id: null }]);
  });
  probe("market-only published insert accepted", async (client) => {
    await client.query("INSERT INTO public.theses(creator_user_id,headline,status,tagged_asset) VALUES ($1,'h','open','ETH')", [u1]);
  });
  for (const column of ["direction", "underlying_asset", "expiry_at", "product_type", "is_call", "is_long", "strikes", "strike_decimals", "collateral_address", "collateral_symbol", "collateral_decimals"]) probe(
    `partial structure rejects missing ${column}`, async (client) => {
      await rejects(client, `UPDATE public.theses SET ${column}=NULL WHERE id=$1`, [t1], check("theses_structure_all_or_nothing"));
    });
  probe("partial structure rejects absent snapshot on insert", async (client) => {
    await rejects(client, "INSERT INTO public.theses(creator_user_id,headline,status,direction,underlying_asset,expiry_at,product_type,is_call,is_long,strikes,strike_decimals,collateral_address,collateral_symbol,collateral_decimals,tagged_asset) SELECT creator_user_id,headline,status,direction,underlying_asset,expiry_at,product_type,is_call,is_long,strikes,strike_decimals,collateral_address,collateral_symbol,collateral_decimals,tagged_asset FROM public.theses WHERE id=$1", [t1], check("theses_structure_all_or_nothing"));
  });
  probe("direction alone is a partial structure", async (client) => {
    await rejects(client, "INSERT INTO public.theses(creator_user_id,headline,status,direction) VALUES ($1,'h','open','bull')", [u1], check("theses_structure_all_or_nothing"));
  });
  probe("tagged asset lowercase rejected", async (client) => {
    await rejects(client, "INSERT INTO public.theses(creator_user_id,headline,status,tagged_asset) VALUES ($1,'h','open','eth')", [u1], check("theses_tagged_asset_uppercase"));
  });
  for (const tag of ["BTC", null]) probe(`structure rejects mismatched tag ${tag}`, async (client) => {
    await rejects(client, "UPDATE public.theses SET tagged_asset=$2 WHERE id=$1", [t1,tag], check("theses_tagged_asset_matches_structure"));
  });
  probe("backing without structure rejected", async (client) => {
    await rejects(client, "INSERT INTO public.theses(creator_user_id,headline,status,creator_position_id) VALUES ($1,'h','open',$2)", [u1,p1], check("theses_backing_requires_structure"));
  });
  probe("unbacked public post does not fence creator wallet", async (client) => {
    await client.query("INSERT INTO public.theses(creator_user_id,headline,status) VALUES ($1,'h','open')", [u1]);
    await client.query("UPDATE public.theses SET status='open' WHERE id=$1", [t1]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("UPDATE public.users SET wallet_address='0xaaa' WHERE id=$1", [u1]);
  });
  probe("unbacked sibling does not weaken linked public wallet fence", async (client) => {
    await client.query("INSERT INTO public.theses(creator_user_id,headline,status) VALUES ($1,'h','open')", [u1]);
    await publish(client);
    await rejects(client, "UPDATE public.users SET wallet_address='0xaaa' WHERE id=$1", [u1], { code: "23514", message: "cannot change wallet of a public thesis creator" });
  });
  probe("likes unique per user and thesis", async (client) => {
    await client.query("INSERT INTO public.likes(user_id,thesis_id) VALUES ($1,$2)", [u1,t1]);
    await rejects(client, "INSERT INTO public.likes(user_id,thesis_id) VALUES ($1,$2)", [u1,t1], { code: "23505", constraint: "likes_user_id_thesis_id_pk" });
  });
  probe("likes allow different users and theses and default timestamp", async (client) => {
    const result = await client.query("INSERT INTO public.likes(user_id,thesis_id) VALUES ($1,$3),($2,$3),($1,$4) RETURNING created_at IS NOT NULL AS dated", [u1,u2,t1,t2]);
    expect(result.rows).toEqual([{ dated: true }, { dated: true }, { dated: true }]);
  });
  probe("like nonexistent thesis rejected", async (client) => {
    await rejects(client, "INSERT INTO public.likes(user_id,thesis_id) VALUES ($1,$2)", [u1,crypto.randomUUID()], { code: "23503", constraint: "likes_thesis_id_theses_id_fk" });
  });
  probe("like nonexistent user rejected", async (client) => {
    await rejects(client, "INSERT INTO public.likes(user_id,thesis_id) VALUES ($1,$2)", [crypto.randomUUID(),t1], { code: "23503", constraint: "likes_user_id_users_id_fk" });
  });
  probe("text-only post can be liked", async (client) => {
    const post = await client.query("INSERT INTO public.theses(creator_user_id,headline,status) VALUES ($1,'h','open') RETURNING id", [u1]);
    await client.query("INSERT INTO public.likes(user_id,thesis_id) VALUES ($1,$2)", [u2,post.rows[0].id]);
  });

  const relationships: [string, string, unknown[]][] = [
    ["other thesis", "thesis_id=$2", [p1,t2]],
    ["other user", "user_id=$2", [p1,u2]],
    ["participant role", "role='participant'", [p1]],
    ["failed status", "status='failed'", [p1]],
    ["chain 1", "chain_id=1", [p1]],
    ["null confirmed_at", "confirmed_at=NULL", [p1]],
    ["wallet mismatch", "wallet_address='0xaaa'", [p1]],
  ];
  for (const [name, assignment, params] of relationships) {
    probe(`initial creator relationship rejects ${name}`, async (client) => {
      // Isolate the trigger's chain predicate from the independent Base CHECK.
      if (name === "chain 1") await client.query("ALTER TABLE public.positions DROP CONSTRAINT positions_base_chain");
      await client.query(`UPDATE public.positions SET ${assignment} WHERE id=$1`, params);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      await rejects(client, "UPDATE public.theses SET creator_position_id=$1,status='open' WHERE id=$2", [p1,t1], { code: "23514", message: `invalid creator position for thesis ${t1}` });
    });
    probe(`referenced creator relationship rejects ${name}`, async (client) => {
      await publish(client);
      if (name === "chain 1") await client.query("ALTER TABLE public.positions DROP CONSTRAINT positions_base_chain");
      await rejects(client, `UPDATE public.positions SET ${assignment} WHERE id=$1`, params, { code: "23514", message: `position ${p1} violates creator invariant for thesis ${t1}` });
    });
  }
  probe("referenced position delete rejected by relationship trigger", async (client) => {
    await publish(client);
    // Remove only the immediate FK inside this rolled-back test to reach the trigger.
    await client.query("ALTER TABLE public.theses DROP CONSTRAINT theses_creator_position_id_positions_id_fk");
    await rejects(client, "DELETE FROM public.positions WHERE id=$1", [p1], { code: "23514", message: `position ${p1} violates creator invariant for thesis ${t1}` });
  });
  for (const status of ["open", "expired", "settled"]) probe(`user wallet mutation rejected with ${status} thesis`, async (client) => {
    await publish(client);
    await client.query("UPDATE public.theses SET status=$1 WHERE id=$2", [status, t1]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await rejects(client, "UPDATE public.users SET wallet_address='0xaaa' WHERE id=$1", [u1], { code: "23514", message: "cannot change wallet of a public thesis creator" });
  });
  probe("thesis link then unlink then position delete accepts final state", async (client) => {
    await client.query("UPDATE public.theses SET creator_position_id=$1 WHERE id=$2", [p1, t1]);
    await client.query("UPDATE public.theses SET creator_position_id=NULL WHERE id=$1", [t1]);
    await client.query("DELETE FROM public.positions WHERE id=$1", [p1]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    expect((await client.query("SELECT creator_position_id FROM public.theses WHERE id=$1", [t1])).rows).toEqual([{ creator_position_id: null }]);
    expect((await client.query("SELECT id FROM public.positions WHERE id=$1", [p1])).rows).toEqual([]);
  });
  probe("thesis intermediate-invalid creator then final-valid accepts current row", async (client) => {
    await client.query("UPDATE public.theses SET creator_position_id=$1,creator_user_id=$2 WHERE id=$3", [p1, u2, t1]);
    await client.query("UPDATE public.theses SET creator_user_id=$1 WHERE id=$2", [u1, t1]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    expect((await client.query("SELECT creator_user_id,creator_position_id FROM public.theses WHERE id=$1", [t1])).rows).toEqual([{ creator_user_id: u1, creator_position_id: p1 }]);
  });
  probe("thesis final-invalid creator rejects current row", async (client) => {
    await client.query("UPDATE public.theses SET creator_position_id=$1 WHERE id=$2", [p1, t1]);
    await rejects(client, "UPDATE public.theses SET creator_user_id=$1 WHERE id=$2", [u2, t1], { code: "23514", message: `invalid creator position for thesis ${t1}` });
  });
  for (const variant of ["position", "wallet"] as const) {
    for (const alreadyPublished of [false, true]) {
      probe(`${variant} intermediate-invalid final-valid (published=${alreadyPublished})`, async (client) => {
        if (alreadyPublished) await publish(client);
        if (variant === "position") {
          await client.query("UPDATE public.positions SET status='failed' WHERE id=$1", [p1]);
          await client.query("UPDATE public.positions SET status='confirmed' WHERE id=$1", [p1]);
        } else {
          await client.query("UPDATE public.users SET wallet_address='0xaaa' WHERE id=$1", [u1]);
          await client.query("UPDATE public.users SET wallet_address='0xabc' WHERE id=$1", [u1]);
        }
        if (!alreadyPublished) await publish(client);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        const result = await client.query("SELECT p.status,p.wallet_address=u.wallet_address AS matching FROM public.positions p JOIN public.users u ON u.id=p.user_id WHERE p.id=$1", [p1]);
        expect(result.rows).toEqual([{ status: "confirmed", matching: true }]);
      });
    }
    probe(`${variant} restored then final-invalid is rejected`, async (client) => {
      await publish(client);
      const invalid = variant === "position"
        ? "UPDATE public.positions SET status='failed' WHERE id=$1"
        : "UPDATE public.users SET wallet_address='0xaaa' WHERE id=$1";
      const restore = variant === "position"
        ? "UPDATE public.positions SET status='confirmed' WHERE id=$1"
        : "UPDATE public.users SET wallet_address='0xabc' WHERE id=$1";
      const id = variant === "position" ? p1 : u1;
      await client.query(invalid, [id]);
      await client.query(restore, [id]);
      await rejects(client, invalid, [id], { code: "23514" });
    });
  }
  probe("same wallet remains accepted for public creator", async (client) => {
    await publish(client);
    await client.query("UPDATE public.users SET wallet_address=wallet_address WHERE id=$1", [u1]);
  });
  probe("linked draft allows a later creator wallet change", async (client) => {
    await client.query("UPDATE public.theses SET creator_position_id=$1 WHERE id=$2", [p1, t1]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("UPDATE public.users SET wallet_address='0xaaa' WHERE id=$1", [u1]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const result = await client.query("SELECT t.status,p.wallet_address AS position_wallet,u.wallet_address AS creator_wallet FROM public.theses t JOIN public.positions p ON p.id=t.creator_position_id JOIN public.users u ON u.id=t.creator_user_id WHERE t.id=$1", [t1]);
    expect(result.rows).toEqual([{ status: "draft", position_wallet: "0xabc", creator_wallet: "0xaaa" }]);
  });
  probe("wallet can change without public theses", async (client) => {
    await client.query("UPDATE public.users SET wallet_address='0xaaa' WHERE id=$1", [u1]);
  });

  for (const status of ["confirmed", "indexed", "expired", "settled"]) {
    for (const [name, value] of [["SQL null", "NULL"], ["missing version", "'{}'::jsonb"], ["wrong version", "'{\"version\":2}'::jsonb"], ["JSON null", "'null'::jsonb"]]) probe(`${status} fill event rejects ${name}`, async (client) => {
      await rejects(client, `UPDATE public.positions SET status=$2,fill_event=${value} WHERE id=$1`, [p1,status], check("positions_confirmed_fill_event_required"));
    });
    probe(`${status} accepts encoded canonical fill event`, async (client) => {
      await client.query("UPDATE public.positions SET status=$2,fill_event=$3 WHERE id=$1", [p1,status,JSON.stringify(canonicalFillEvent)]);
    });
  }
  for (const status of ["pending", "failed"]) probe(`${status} accepts absent fill event`, async (client) => {
    await client.query("UPDATE public.positions SET status=$2,fill_event=NULL WHERE id=$1", [p1,status]);
  });
  for (const [table, column, id, other, message] of [
    ["theses", "creator_order_snapshot", t1, "headline='changed'", "creator order snapshot is immutable"],
    ["positions", "order_snapshot", p1, "order_id='changed'", "position order snapshot is immutable"],
  ]) {
    probe(`${table} changed order snapshot rejected`, async (client) => {
      await rejects(client, `UPDATE public.${table} SET ${column}='{"changed":true}'::jsonb WHERE id=$1`, [id], { code: "23514", message });
    });
    probe(`${table} identical order snapshot accepted`, async (client) => {
      await client.query(`UPDATE public.${table} SET ${column}='{}'::jsonb WHERE id=$1`, [id]);
    });
    probe(`${table} other columns remain updatable`, async (client) => {
      await client.query(`UPDATE public.${table} SET ${other} WHERE id=$1`, [id]);
    });
  }
  probe("activity requires an underlying reference", async (client) => {
    await rejects(client, "INSERT INTO public.activity(user_id,event_type) VALUES ($1,'test')", [u1], check("activity_domain_reference_required"));
  });
  for (const column of ["thesis_id", "position_id"]) probe(`activity accepts ${column} reference`, async (client) => {
    await client.query(`INSERT INTO public.activity(user_id,event_type,${column}) VALUES ($1,'test',$2)`, [u1,column === "thesis_id" ? t1 : p1]);
  });
  probe("trigger functions pin search_path", async (client) => {
    const result = await client.query("SELECT proname,proconfig FROM pg_catalog.pg_proc WHERE oid IN ('public.enforce_thesis_creator_position()'::regprocedure,'public.enforce_public_creator_wallet_unchanged()'::regprocedure,'public.enforce_order_snapshot_immutable()'::regprocedure)");
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) expect(row.proconfig).toContain("search_path=pg_catalog, public");
    await client.query("SET LOCAL search_path = pg_catalog");
    await publish(client);
  });
});
