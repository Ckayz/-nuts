# @nuts/thetanuts

Framework-neutral Thetanuts OptionBook logic for Base mainnet.

- `createReadClient({ rpcUrl, referrer? })` creates a read-only SDK client with browser-safe memory storage; `assertBaseChain(chainId)` guards wallet chain selection.
- `fetchLiveOrders(client, now?)` fetches API-advertised rows passing local amount and expiry filters; cancellation and minimum-size preflight are not checked. `deriveMarkets(orders, now?)` resolves feed, collateral and implementation metadata. `listAssets`, `listExpiries`, and `listStructures` group results.
- `quoteFill({ client, order, budget, referrer?, now? })` turns collateral-base-unit premium spend into a capped fill quote.
- `premiumUsd8From` converts collateral-base-unit premium to total 8-decimal USD premium; `payoffAtExpiry`, `payoffCurve`, `maxLoss`, `maxPayout`, and `breakEven` calculate vanilla/spread long or short risk from explicit strikes, size, total USD premium, and contract-size decimals.
- `buildFillTransactions({ client, order, budget, referrer?, account, now? })` returns optional exact ERC-20 approval calldata, fill calldata, and expected values. Call `assertBaseChain` separately.
- `parseOrderFilled(logs, { optionBook })` extracts canonical r12 fill fields emitted by the expected OptionBook; `expectOrderFilled(logs, { optionBook, buyer?, seller?, nonce? })` requires exactly one matching fill.
- `getIndexedPositions`, `getOptionState`, and `settledPayout` wrap the supported indexer and on-chain reads.
- `ThetanutsLogicError` exposes stable local error codes and optional details.

## UNVERIFIED

- Contract-size decimals vary ambiguously across the SDK material; every risk call requires a verified `contractSizeDecimals`.
- Sell-side call collateral, non-USDC contract units, and on-chain collateral/fee/budget rounding remain UNVERIFIED. Sell APIs are blocked as explained below.
- Budget-cap premium rounding must be verified on-chain; quotes deliberately recompute the floored premium.
- The SDK's browser bundle retains `FileStorageProvider` dynamic `fs/promises` imports; the target Next.js client-boundary build is UNVERIFIED.
- ERC-20 approval quirks, minimum/cancellation preflight, and settlement operations remain outside this pure package's guarantees.

No defaults are supplied for budget, fees, slippage, or gas headroom.

## Sides

`takerSide(order)` maps raw `isLong: true` to taker BUY and `false` to SELL;
missing raw data throws `INVALID_ORDER`. `quoteFill` and `buildFillTransactions`
are buy-only. Their deprecated `allowUnverifiedTakerSell` property is retained
for source compatibility but never bypasses the `TAKER_SELL_UNVERIFIED` gate.

Supplied decoded Base production fills (not fetched again during this round):

| Transaction | Taker | Contracts | Premium | Fee | Seller collateral |
| --- | --- | ---: | ---: | ---: | ---: |
| `0x9c4bb145a85740323a14f99cfbbf69c7da18bef1a8fa8f087d2330d095828f8c` | Buy put | 389926 | 999998 | 124999 | 912426840 |
| `0xdf3323fefb54cd040a0e86cca3733e4c469a77e33c85a0351e9e987dcfda76f3` | Sell put | 10000 | 21268 | 2658 | 22000000 |
| `0xa2edb8b2f6ad2df3435934a59227e988e840472248ec7810532602302489be46` | Buy four-strike call structure | 43333 | 10000100 | 1250012 | 43333000 |

Amounts are USDC/aBasUSDC base units. The buyer pays floored
`contracts × price / 1e8`; the seller receives premium minus fee and posts
collateral separately. The sell put posts `220000000000 × 10000 / 1e8 = 22000000`
and receives `18610`. These examples support six-decimal contract units only
for the supplied USDC/aBasUSDC fills. The four-strike implementation address was
not supplied; do not infer its type solely from its strikes or collateral.

The brief's documented fee formula is an **estimate**:
`min(0.06% of notional, 12.5% of premium)`. Tests reproduce the observed
premium-percentage branch only; they do not validate implementation-specific
notional or establish fee policy. `maxLoss` returns net loss in USD8: strike
exposure for short puts or width exposure for short spreads, minus received
premium. With zero premium it returns the full gross exposure.

### Round 5 stopped items: sell quote and fill

`quoteSellFill`, `buildSellFillTransactions`, and the proposed
`allowUnverifiedCallCollateral` opt-in are **not implemented**. The writer stopped
B and dependent C under the brief's explicit SDK-contradiction instruction.
Tests of those APIs, the opt-in gate, and the full fee estimate are therefore
also outstanding. No sell path is enabled.

Installed SDK 0.3.0 `dist/index.js`, `calculateMaxContracts`:

```js
// 1649: availableAmount, not a side-dependent premium budget
const maxCollateral = orderWithSig.availableAmount;
// 1656–1659: no isLong branch
if (!isCall && strikes.length === 1) {
  const strike = strikes[0];
  return maxCollateral * 100000000n / strike;
}
// 1717 and 1867: both preview and encoder use this cap
const maxContracts = this.calculateMaxContracts(orderWithSig);
```

Offline test output for strike `220000000000`, price `212682750`, and
hypothetical remaining amount `22000000` (not a claimed historical order field):

```text
SDK sell PUT: preview cap=10000; requested premium-based cap=10344045; encoded contracts=10000
SDK four-strike cap with 43333000 available=21666; supplied fill contracts=43333
```

The requested `maxCollateralUsable × 1e8 / price` cap does **not** match preview.
`encodeFillOrder` calculates amount × 1e8 / price (1870), then applies the same
cap (1874–1875); increasing its amount cannot overcome it. No signed fields or
available amounts were rewritten to evade this. Below the cap, a ceiling-rounded
premium is only a candidate amount: integer amounts can skip contract counts
when price < 1e8, so exact decoded equality would still be required.

Other discrepancies from the source:

- Preview uses the outer strike range for three or more strikes (1682–1691),
  whereas the supplied four-strike collateral corresponds to width 1000.
- The separate implementation-specific `calculateCollateralRequired` helper
  (16957–17001) uses one underlying unit for INVERSE_CALL, strike for LINEAR_CALL,
  `1 - low/high` for inverse spreads, twice the first wing for RANGER, and the
  larger wing for iron condors. RANGER's formula reproduces the supplied
  four-strike collateral but does not identify the historical implementation.
- Thus generic “call = one underlying unit” does not cover every implementation.
  OptionBook inverse-call collateral, non-USDC units, and on-chain rounding
  remain UNVERIFIED. These preview/implementation differences require resolution
  before implementing the requested sell APIs.

The new tests exercise real SDK pure preview/encoding with local fixtures,
decode the sell-put cap, reproduce the supplied transfer arithmetic, and verify
short net risk. No test calls an RPC or the order feed. These are evidence tests,
not validation of a sell API implementation.
