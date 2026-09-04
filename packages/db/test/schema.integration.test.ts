import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) console.log("schema integration skipped: DATABASE_URL is not set");
const integrationTest = databaseUrl ? test : test.skip;
let client: Client;

describe("migrated schema constraints", () => {
  beforeAll(async () => { if (!databaseUrl) return; client = new Client({ connectionString: databaseUrl }); await client.connect(); await client.query("BEGIN"); });
  afterAll(async () => { if (!databaseUrl) return; await client.query("ROLLBACK"); await client.end(); });
  async function rejects(sql: string, params: unknown[] = []) { await client.query("SAVEPOINT probe"); let failed = false; try { await client.query(sql, params); await client.query("SET CONSTRAINTS ALL IMMEDIATE"); } catch { failed = true; await client.query("ROLLBACK TO SAVEPOINT probe"); } await client.query("SET CONSTRAINTS ALL DEFERRED"); expect(failed).toBe(true); }

  integrationTest("wallet, nonce, transaction, thesis, partial-index, integral, and creator-position fences", async () => {
    const u1 = "10000000-0000-4000-8000-000000000001", u2 = "10000000-0000-4000-8000-000000000002";
    const t1 = "20000000-0000-4000-8000-000000000001", t2 = "20000000-0000-4000-8000-000000000002";
    const p1 = "30000000-0000-4000-8000-000000000001";
    await client.query("INSERT INTO users(id,wallet_address) VALUES ($1,'0xabc'),($2,'0xdef')", [u1,u2]);
    await rejects("INSERT INTO users(wallet_address) VALUES ('0xABC')");
    await client.query("INSERT INTO auth_challenges(wallet_address,nonce,domain,chain_id,expires_at) VALUES ('0xabc','nonce-1','test',8453,now())");
    await rejects("INSERT INTO auth_challenges(wallet_address,nonce,domain,chain_id,expires_at) VALUES ('0xabc','nonce-1','test',8453,now())");
    await rejects("INSERT INTO auth_challenges(wallet_address,nonce,domain,chain_id,expires_at) VALUES ('0xABC','nonce-2','test',8453,now())");
    await client.query("INSERT INTO theses(id,creator_user_id,headline,direction,status,underlying_asset,expiry_at,product_type,is_call,is_long,strikes,strike_decimals,collateral_address,collateral_symbol,collateral_decimals,creator_order_snapshot) VALUES ($1,$2,'h','bull','draft','ETH',now(),'call',true,true,ARRAY[1]::numeric[],8,'0xc','USDC',6,'{}'),($3,$2,'h2','bull','draft','ETH',now(),'call',true,true,ARRAY[1]::numeric[],8,'0xc','USDC',6,'{}')", [t1,u1,t2]);
    await rejects("UPDATE theses SET status='open' WHERE id=$1", [t1]);
    const positionSql = "INSERT INTO positions(id,thesis_id,user_id,role,side,status,chain_id,wallet_address,order_id,order_snapshot,tx_hash,budget,budget_decimals,contracts,contract_decimals,premium,premium_decimals,fees,fee_decimals,collateral,collateral_decimals,break_even_prices,break_even_price_decimals,break_even_prices_usd,confirmed_at) VALUES ($1,$2,$3,'creator','back','confirmed',8453,'0xabc','o','{}','0x" + "1".repeat(64) + "',1,6,1,8,1,6,0,6,1,6,ARRAY[]::numeric[],8,ARRAY[]::numeric[],now())";
    await client.query(positionSql, [p1,t1,u1]); await client.query("UPDATE theses SET creator_position_id=$1,status='open' WHERE id=$2", [p1,t1]); await client.query("SET CONSTRAINTS ALL IMMEDIATE"); await client.query("SET CONSTRAINTS ALL DEFERRED");
    await rejects("UPDATE positions SET wallet_address='0xABC' WHERE id=$1", [p1]);
    await rejects("INSERT INTO positions(thesis_id,user_id,role,side,status,chain_id,wallet_address,order_id,order_snapshot,tx_hash,budget,budget_decimals,contracts,contract_decimals,premium,premium_decimals,fees,fee_decimals,collateral,collateral_decimals,break_even_prices,break_even_price_decimals,break_even_prices_usd) SELECT thesis_id,user_id,role,side,status,chain_id,wallet_address,order_id,order_snapshot,tx_hash,budget,budget_decimals,contracts,contract_decimals,premium,premium_decimals,fees,fee_decimals,collateral,collateral_decimals,break_even_prices,break_even_price_decimals,break_even_prices_usd FROM positions WHERE id=$1", [p1]);
    await rejects("UPDATE positions SET role='participant' WHERE id=$1", [p1]);
    await rejects("UPDATE positions SET status='failed' WHERE id=$1", [p1]);
    await rejects("UPDATE positions SET thesis_id=$2 WHERE id=$1", [p1,t2]);
    await rejects("UPDATE positions SET user_id=$2 WHERE id=$1", [p1,u2]);
    await rejects("UPDATE positions SET chain_id=1 WHERE id=$1", [p1]);
    await rejects("UPDATE positions SET confirmed_at=NULL WHERE id=$1", [p1]);
    await rejects("DELETE FROM positions WHERE id=$1", [p1]);
    await rejects("UPDATE positions SET budget=1.5 WHERE id=$1", [p1]);
    await rejects("UPDATE theses SET creator_position_id=$1 WHERE id=$2", [p1,t2]);
  });
});
