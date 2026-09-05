import type { Client } from "pg";
import { canonicalFillEvent } from "./fill-event";

export const u1 = "10000000-0000-4000-8000-000000000001";
export const u2 = "10000000-0000-4000-8000-000000000002";
export const t1 = "20000000-0000-4000-8000-000000000001";
export const t2 = "20000000-0000-4000-8000-000000000002";
export const p1 = "30000000-0000-4000-8000-000000000001";

export async function seed(client: Client, ids = { u1, u2, t1, t2, p1 }, unique = false) {
  const { u1, u2, t1, t2, p1 } = ids;
  const wallet = unique ? `0x${u1.replaceAll("-", "")}` : "0xabc";
  const otherWallet = unique ? `0x${u2.replaceAll("-", "")}` : "0xdef";
  await client.query("INSERT INTO public.users(id,wallet_address) VALUES ($1,$3),($2,$4)", [u1, u2, wallet, otherWallet]);
  await client.query("INSERT INTO public.auth_challenges(wallet_address,nonce,domain,chain_id,expires_at) VALUES ($1,$2,'test',8453,now())", [wallet, unique ? u1 : "nonce-1"]);
  await client.query("INSERT INTO public.theses(id,creator_user_id,headline,tagged_asset,direction,status,underlying_asset,expiry_at,product_type,is_call,is_long,strikes,strike_decimals,collateral_address,collateral_symbol,collateral_decimals,creator_order_snapshot) VALUES ($1,$2,'h','ETH','bull','draft','ETH',now(),'call',true,true,ARRAY[1]::numeric[],8,'0xc','USDC',6,'{}'),($3,$2,'h2','ETH','bull','draft','ETH',now(),'call',true,true,ARRAY[1]::numeric[],8,'0xc','USDC',6,'{}')", [t1, u1, t2]);
  await client.query("INSERT INTO public.positions(id,thesis_id,user_id,role,side,status,chain_id,wallet_address,order_id,order_snapshot,fill_event,tx_hash,budget,budget_decimals,contracts,contract_decimals,premium,premium_decimals,fees,fee_decimals,collateral,collateral_decimals,break_even_prices,break_even_price_decimals,break_even_prices_usd,confirmed_at) VALUES ($1,$2,$3,'creator','back','confirmed',8453,$6,'o','{}',$4,$5,1,6,1,8,1,6,0,6,1,6,ARRAY[]::numeric[],8,ARRAY[]::numeric[],now())", [p1, t1, u1, JSON.stringify(canonicalFillEvent), unique ? "0x" + p1.replaceAll("-", "").repeat(2) : "0x" + "1".repeat(64), wallet]);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  await client.query("SET CONSTRAINTS ALL DEFERRED");
}

