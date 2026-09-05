import { Wallet, JsonRpcProvider } from "ethers";
import { OPTION_BOOK_ABI } from "@thetanuts-finance/thetanuts-client";
import { decodeFunctionData, decodeEventLog, erc20Abi, getAddress, type Address, type Hex, type Log } from "viem";
import { createReadClient, fetchLiveOrders, deriveMarkets, takerSide, quoteFill, quoteSellFill, buildFillTransactions, buildSellFillTransactions, expectOrderFilled, VERIFIED_SELL_PAIRS, assertBaseChain, type Market, type ParsedOrderFilled } from "../src";

type Side = "buy" | "sell";
export interface Selection { side: Side; collateral?: string; nonce?: string; allowUnverified: boolean }
export function selectMarket(markets: readonly Market[], selection: Selection): Market {
  const candidates = markets.filter(m => takerSide(m.order) === selection.side && m.collateralToken.decimals !== null &&
    (selection.nonce === undefined || m.order.order.nonce.toString() === selection.nonce) &&
    (selection.collateral ? m.collateralToken.symbol?.toLowerCase() === selection.collateral.toLowerCase() : selection.side !== "buy" || ["usdc", "abasusdc"].includes(m.collateralToken.symbol?.toLowerCase() ?? "")) &&
    (selection.side !== "sell" || selection.allowUnverified || (m.side === "put" && VERIFIED_SELL_PAIRS.some(p => p.implementation === m.implementation.address.toLowerCase() && p.collateral === m.collateralToken.address.toLowerCase()))));
  if (selection.nonce && candidates.length > 1) throw new Error("Pinned nonce is ambiguous across makers; refuse");
  // Compare signed premium price in token units with integer arithmetic, never floats.
  candidates.sort((a, b) => {
    const left = a.pricePerContract * 10n ** BigInt(b.collateralToken.decimals!);
    const right = b.pricePerContract * 10n ** BigInt(a.collateralToken.decimals!);
    return left < right ? -1 : left > right ? 1 : a.order.order.maker.localeCompare(b.order.order.maker) || a.order.order.nonce.toString().localeCompare(b.order.order.nonce.toString());
  });
  if (!candidates[0]) throw new Error("No matching live order; no transaction sent");
  return candidates[0];
}
export function decimalUnits(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("Budget must be a positive plain decimal");
  const [whole = "", fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("Budget has more fractional digits than collateral decimals");
  const units = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (units <= 0n) throw new Error("Budget must be positive");
  return units;
}
export interface Transfer { token: string; from: string; to: string; amount: bigint }
export interface Expected { premium: bigint; fee: bigint; collateral: bigint }
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function compareFill(side: Side, expected: Expected, event: ParsedOrderFilled, transfers: readonly Transfer[], token: string, wallet: string, book: string) {
  const relevant = transfers.filter(t => same(t.token, token));
  const sum = (predicate: (t: Transfer) => boolean) => relevant.filter(predicate).reduce((n, t) => n + t.amount, 0n);
  const outgoing = sum(t => same(t.from, wallet));
  const incoming = sum(t => same(t.to, wallet));
  const actual = {
    premium: event.premiumAmount,
    fee: event.feeCollected,
    collateral: side === "sell" ? outgoing : outgoing - event.premiumAmount,
    debit: outgoing,
    credit: incoming,
    feeTransfer: sum(t => same(t.from, event.buyer) && same(t.to, book)),
  };
  const values = { ...expected, debit: side === "buy" ? expected.premium : expected.collateral, credit: side === "sell" ? expected.premium - expected.fee : 0n, feeTransfer: expected.fee };
  return (Object.keys(values) as (keyof typeof values)[]).map(field => ({ field, expected: values[field].toString(), actual: actual[field].toString(), match: values[field] === actual[field] }));
}
function args(argv: string[]) {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (["--send", "--allow-unverified"].includes(arg)) { if (flags.has(arg)) throw new Error(`Duplicate ${arg}`); flags.add(arg); }
    else if (["--side", "--budget", "--collateral", "--order"].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith("--") || values.has(arg)) throw new Error(`Missing or duplicate ${arg}`);
      values.set(arg, value);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  const side = values.get("--side");
  if (side !== "buy" && side !== "sell") throw new Error("Required: --side buy|sell --budget <decimal>");
  const budget = values.get("--budget");
  if (!budget) throw new Error("Required: --budget <decimal>; no default");
  const nonce = values.get("--order");
  if (nonce !== undefined && !/^\d+$/.test(nonce)) throw new Error("--order must be an unsigned decimal nonce");
  return { side, budget, collateral: values.get("--collateral"), nonce: nonce === undefined ? undefined : BigInt(nonce).toString(), allowUnverified: flags.has("--allow-unverified"), send: flags.has("--send") } as const;
}
const print = (label: string, value: unknown) => console.log(label, JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
const seconds = (m: Market) => BigInt(m.order.rawApiData!.orderExpiryTimestamp) - BigInt(Math.floor(Date.now() / 1000));

export async function main(argv = process.argv.slice(2)) {
  const options = args(argv);
  const ceiling = process.env.TINY_FILL_MAX_BUDGET;
  if (!ceiling) throw new Error("Set TINY_FILL_MAX_BUDGET to the owner's hard ceiling; no default");
  // Validate decimal inputs before any RPC or key handling.
  decimalUnits(options.budget, 255); decimalUnits(ceiling, 255);
  if (decimalUnits(options.budget, 255) > decimalUnits(ceiling, 255)) throw new Error("--budget exceeds TINY_FILL_MAX_BUDGET");
  const key = process.env.TINY_FILL_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Set TINY_FILL_PRIVATE_KEY in this shell run (32-byte hex)");
  const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  const referrer = getAddress(process.env.THESIS_REFERRER ?? "0xd5E66B6d957C2d5e6C8c167707a49a029D1247dd");
  const provider = new JsonRpcProvider(rpcUrl);
  try {
    let wallet: Wallet;
    try { wallet = new Wallet(key, provider); } catch { throw new Error("Invalid TINY_FILL_PRIVATE_KEY"); }
    const account = getAddress(wallet.address);
    assertBaseChain(Number((await provider.getNetwork()).chainId));
    if (await provider.getBalance(account) === 0n) throw new Error("Wallet ETH balance is zero; gas required");
    const client = createReadClient({ rpcUrl, referrer });
    const fetch = async () => deriveMarkets(await fetchLiveOrders(client));
    let market = selectMarket(await fetch(), options);
    if (same(market.order.order.maker, account)) throw new Error("Refuse to fill an order made by this wallet");
    const refresh = async () => {
      const matches = (await fetch()).filter(m => same(m.order.order.maker, market.order.order.maker) && m.order.order.nonce === market.order.order.nonce);
      const next = selectMarket(matches, options);
      if (!same(next.collateralToken.address, market.collateralToken.address)) throw new Error("Pinned order collateral changed");
      market = next;
    };
    if (seconds(market) < 30n) { console.warn("Signature has under 30 seconds remaining; refreshing once"); await refresh(); }
    const prepare = async () => {
      if (seconds(market) < 30n) throw new Error("Signature still has under 30 seconds remaining; refuse");
      const quotedAt = Date.now();
      const budget = decimalUnits(options.budget, market.collateralToken.decimals!);
      const common = { client, order: market.order, referrer, account };
      const quote = options.side === "buy" ? quoteFill({ ...common, budget }) : quoteSellFill({ ...common, collateralBudget: budget, allowUnverifiedStructureCollateral: options.allowUnverified });
      const transactions = options.side === "buy" ? await buildFillTransactions({ ...common, budget }) : await buildSellFillTransactions({ ...common, collateralBudget: budget, allowUnverifiedStructureCollateral: options.allowUnverified });
      const premium = "premium" in quote ? quote.premium : quote.premiumGross;
      // Research finding-fill-debits.md: premium-percentage branch; notional branch remains UNVERIFIED.
      const expected = { premium, fee: "feeEstimate" in quote ? quote.feeEstimate : premium * 1250n / 10000n, collateral: "collateralRequired" in quote ? quote.collateralRequired : 0n };
      const debit = options.side === "buy" ? premium : expected.collateral;
      if (debit <= 0n || debit > budget) throw new Error("Expected wallet debit is zero or exceeds --budget");
      const decoded = decodeFunctionData({ abi: OPTION_BOOK_ABI, data: transactions.fill.data });
      const encoded = decoded.args?.[0];
      if (decoded.functionName !== "fillOrder" || typeof encoded !== "object" || !encoded || !("numContracts" in encoded) || encoded.numContracts !== quote.numContracts) throw new Error("Quote/calldata contract count mismatch");
      print("Order", { maker: market.order.order.maker, nonce: market.order.order.nonce, implementation: market.implementation, strikes: market.strikes, expiry: market.expiry, collateral: market.collateralToken, price: market.pricePerContract, signatureExpiry: market.order.rawApiData!.orderExpiryTimestamp, secondsRemaining: seconds(market) });
      print("Quote (base units; fee is an estimate)", quote);
      print("Expected wallet flows", { ...expected, debit: options.side === "buy" ? premium : expected.collateral, credit: options.side === "sell" ? premium - expected.fee : 0n });
      if (transactions.approve) {
        const approval = decodeFunctionData({ abi: erc20Abi, data: transactions.approve.data });
        if (approval.functionName !== "approve") throw new Error("Invalid approval");
        print("Approval", { token: transactions.approve.to, spender: approval.args[0], amount: approval.args[1] });
      } else print("Approval", "Existing allowance sufficient");
      print("Fill", { to: transactions.fill.to, dataBytes: (transactions.fill.data.length - 2) / 2, decodedNumContracts: encoded.numContracts, data: transactions.fill.data });
      return { quote, transactions, expected, quotedAt };
    };
    let plan = await prepare();
    const estimate = async (tx: { to: string; data: string; value: bigint }) => { const gas = await wallet.estimateGas(tx); print("Gas estimate", { to: tx.to, gas }); return gas; };
    if (!options.send) {
      if (plan.transactions.approve) { await estimate(plan.transactions.approve); console.log("Fill gas estimate requires mined allowance; deferred until --send approval receipt"); }
      else await estimate(plan.transactions.fill);
      console.log("DRY RUN: nothing broadcast. Add --send to approve and fill once."); return;
    }
    if (plan.transactions.approve) {
      const approve = plan.transactions.approve;
      const gasLimit = await estimate(approve);
      const sent = await wallet.sendTransaction({ ...approve, gasLimit }); print("Approval hash", sent.hash);
      const receipt = await sent.wait();
      if (!receipt || receipt.status !== 1) throw new Error("Approval failed; no fill sent");
      print("Approval receipt", { hash: receipt.hash, blockNumber: receipt.blockNumber, status: receipt.status });
      // Approval may outlive the signature: refresh the SAME maker/nonce and re-quote, never re-approve automatically.
      await refresh(); plan = await prepare();
      if (plan.transactions.approve) throw new Error("Refreshed quote needs another approval; stop without filling");
    }
    const gasLimit = await estimate(plan.transactions.fill);
    if (Date.now() - plan.quotedAt >= 30_000 || seconds(market) < 30n) throw new Error("Quote/signature too old after gas estimation; stop without filling");
    const sent = await wallet.sendTransaction({ ...plan.transactions.fill, gasLimit }); print("Fill hash", sent.hash);
    const receipt = await sent.wait();
    if (!receipt || receipt.status !== 1) throw new Error("Fill failed; never retry automatically");
    print("Fill receipt", { hash: receipt.hash, blockNumber: receipt.blockNumber, status: receipt.status });
    const logs: Log<bigint, number, false>[] = receipt.logs.map(l => ({ address: l.address as Address, data: l.data as Hex, topics: [...l.topics] as [Hex, ...Hex[]], blockHash: l.blockHash as Hex, blockNumber: BigInt(l.blockNumber), transactionHash: l.transactionHash as Hex, transactionIndex: l.transactionIndex, logIndex: l.index, removed: false }));
    const event = expectOrderFilled(logs, { optionBook: plan.transactions.fill.to, nonce: market.order.order.nonce, buyer: (options.side === "buy" ? account : market.order.order.maker) as Address, seller: (options.side === "sell" ? account : market.order.order.maker) as Address });
    print("OrderFilled", event);
    const transfers: Transfer[] = [];
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics, strict: true });
        transfers.push({ token: log.address, from: decoded.args.from, to: decoded.args.to, amount: decoded.args.value });
      } catch { /* Not an ERC-20 Transfer. */ }
    }
    print("All ERC-20 Transfers (raw token base units)", transfers);
    const comparison = compareFill(options.side, plan.expected, event, transfers, market.collateralToken.address, account, plan.transactions.fill.to);
    console.log("expected vs actual (collateral = wallet collateral debit)"); console.table(comparison);
    if (event.sellerWasMaker !== (options.side === "buy") || comparison.some(row => !row.match)) throw new Error("Receipt mismatch; investigate recorded transaction, never retry automatically");
  } finally { provider.destroy(); }
}
if (import.meta.main) main().catch(error => {
  // Never dump provider/wallet error objects: they may contain credentials or signed transactions.
  let message = error instanceof Error ? error.message : "Unknown failure";
  for (const secret of [process.env.TINY_FILL_PRIVATE_KEY, process.env.BASE_RPC_URL]) if (secret) message = message.split(secret).join("[REDACTED]");
  console.error(message.replace(/0x[0-9a-fA-F]{64,}/g, "[REDACTED HEX]")); process.exitCode = 1;
});
