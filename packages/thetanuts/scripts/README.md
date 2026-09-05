# Owner-run tiny Base fill

Each invocation fills one order. Default dry run performs RPC reads, prints the quote/calldata, and estimates gas. Only `--send` permits approval and fill broadcasts. Run buy and sell separately.

From `packages/thetanuts`:

```sh
bun run tiny-fill --side buy --budget <owner-budget>
bun run tiny-fill --side sell --budget <owner-budget>
# Inspect the output, then repeat the chosen command with --send.
```

Set `TINY_FILL_PRIVATE_KEY` (0x-prefixed 32-byte hex) **only in the shell for that run**, using a hidden shell prompt or secret manager. Never save it in shell history, an env file, a fixture or git. Unset it immediately afterward. Dry runs need it to derive the account and inspect allowance/gas but do not sign or broadcast. Bun automatically loads env files; do not store this key in any `.env` file.

Required `TINY_FILL_MAX_BUDGET` is the owner's positive decimal hard ceiling in the selected collateral token's units. No budget or ceiling defaults exist. Missing values, excessive precision, exceeded ceiling, wrong chain and zero ETH balance refuse. There is no USD conversion; set the ceiling deliberately for each run's collateral.

Optional environment:

- `BASE_RPC_URL`: default `https://mainnet.base.org`.
- `THESIS_REFERRER`: default `0xd5E66B6d957C2d5e6C8c167707a49a029D1247dd`.

Arguments:

- `--side buy|sell` and `--budget <decimal>` required. Buy budget funds premium; sell budget funds gross collateral before premium credit. The side comes from the package's `takerSide`, corrected in round 9 against decoded chain bytes: a maker order with `isLong: false` is the taker **BUY** side (fill `0x9c4bb145a85740323a14f99cfbbf69c7da18bef1a8fa8f087d2330d095828f8c`) and `isLong: true` is the taker **SELL** side (fill `0xdf3323fefb54cd040a0e86cca3733e4c469a77e33c85a0351e9e987dcfda76f3`). Rounds 1–8 had this backwards, so a `--side buy` run before this correction would have selected a sell order.
- `--collateral <symbol>` filters live SDK symbols. Buy defaults to USDC/aBasUSDC ordered by lowest signed price per contract in token units, not total maker capacity or USD. Sell defaults to the package's verified address pair.
- `--order <nonce>` pins a nonce. Ambiguous eligible makers refuse; all side, collateral and verification filters still apply.
- `--allow-unverified` permits additional sell pairs supported by the package. It does not bypass its structure/decimal guards.
- `--send` sends at most one approval and one fill. Never automatically retries a transaction.

Output includes order identity, implementation, strikes, expiry, token decimals, quote in base units, estimated fee, expected wallet debit/credit, approval, calldata and decoded contract count. Fee uses the 12.5%-of-premium branch, which is an **upper bound**: the notional branch of `min(0.06% notional, 12.5% premium)` fires on Base (fill `0x3e7417c5c676109e737f540debe95d0aec9477c9797c19f37e626d0c611cff04` collected 737 on a 9009 premium). On such an order the receipt comparison below reports a fee mismatch and exits nonzero **after** the fill is mined, even though nothing went wrong.

Signatures with under 30 seconds remaining trigger one read refresh for the same maker/nonce, then refuse if still too old. After mined approval the script refreshes that identity and prints a new quote, refusing if another approval is needed. Before fill submission it requires quote age below 30 seconds and signature validity of at least 30 seconds. This bounds submission, not mining. The gas limit is the printed RPC estimate, without invented headroom or replacement policy. Dry runs with insufficient allowance estimate approval gas and defer fill gas estimation until allowance is mined.

Receipt output includes `expectOrderFilled` fields and every decodable ERC-20 Transfer. Exact expected/actual comparisons cover premium, fee, wallet collateral debit, total wallet debit/credit and buyer-to-book fee transfer. Buy wallet collateral debit is zero; maker collateral remains visible in the transfer list. A mismatch exits nonzero **after the fill happened** and cannot undo it. Inspect the recorded hash before any manual rerun.

Offline fixtures use the amounts from the main checkout's `.research/thetanuts/finding-fill-debits.md` (full transaction hashes in tests); addresses label roles. These tests do not verify non-USDC units, capped rounding or additional sell pairs onchain.

```sh
bunx tsc --noEmit
bun test scripts
```
