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
- All structures except single-strike PUT require `allowUnverifiedStructureCollateral: true`; otherwise they throw `STRUCTURE_COLLATERAL_UNVERIFIED`. RANGER has evidence only for the specified implementation’s inner-width formula, not its complete taker-SELL path. Non-USDC contract units and on-chain collateral/fee/budget rounding remain UNVERIFIED. The notional fee branch remains UNVERIFIED.
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
| `0xa2edb8b2f6ad2df3435934a59227e988e840472248ec7810532602302489be46` | Buy RANGER | 43333 | 10000100 | 1250012 | 43333000 |

Amounts are USDC/aBasUSDC base units. The buyer pays floored
`contracts × price / 1e8`; the seller receives premium minus fee and posts
collateral separately. The sell put posts `220000000000 × 10000 / 1e8 = 22000000`
and receives `18610`. These examples support six-decimal contract units only
for the supplied USDC/aBasUSDC fills. The four-strike implementation is
`0x9980ec85bc6fE07340adb36c76FA093bb6D4FcBc`: SDK
`getOptionImplementationInfo(8453, address)` identifies RANGER with four strikes.

The brief's documented fee formula is an **estimate**:
`min(0.06% of notional, 12.5% of premium)`. Tests reproduce the observed
premium-percentage branch only; they do not validate implementation-specific
notional or establish fee policy. `maxLoss` returns net loss in USD8: strike
exposure for short puts or width exposure for short spreads, minus received
premium. With zero premium it returns the full gross exposure.

### Sell quote and fill

`quoteSellFill({ client, order, collateralBudget, referrer?, now?, allowUnverifiedStructureCollateral? })`
returns contracts, collateral required, gross premium, fee estimate, estimated net
premium, and cap metadata. Buy orders throw `INVALID_SIDE`; all structures except
single-strike PUT require
`allowUnverifiedStructureCollateral: true`. Budgets are collateral-token base units.

`buildSellFillTransactions({ client, order, collateralBudget, account, referrer?, now?, allowUnverifiedStructureCollateral? })`
returns optional exact collateral approval, fill calldata, and expected amounts.
It approves the target validated by the SDK encoder. It starts with ceiling-rounded
premium and verifies the decoded contract count, rejecting unrepresentable counts
with `ENCODE_MISMATCH` before reading allowance. No signed order fields are changed.

SDK 0.3.0 `usdcAmount` is premium-denominated on **both sides**: encoding divides
amount × 1e8 by price. Its public `calculateMaxContracts` instead caps against
`availableAmount` as collateral, independent of side. That capacity cap remains
unchanged and is **not** the seller collateral formula. Implementation metadata
(`type`, `numStrikes`, and name) determines the collateral helper. Unknown or
unsupported implementations fail closed even with opt-in; strike counts must
match metadata.

Seller sizing uses `budget × 1e8 / collateralPerContract`; collateral and exact
approval use `contracts × collateralPerContract / 1e8`. The SDK bigint
`utils.calculateCollateral` supplies PUT/linear-call, spread, butterfly and
condor formulas, with equal size/collateral decimals. PUT_FLY uses one wing
(2400/2300/2200 → 100), not the capacity cap's outer width (200).
Inverse calls use the SDK's one-underlying-per-contract formula in bigint units;
unknown token units fail closed. Inverse spreads and physical implementations
remain unsupported even with opt-in rather than using a floating-point helper.

For RANGER, only `0x9980ec85bc6fE07340adb36c76FA093bb6D4FcBc` is supported:
collateral per contract is sorted `strikes[2] - strikes[1]`. The supplied fill
supports this formula at that address: 43333 contracts → 43333000 collateral,
10000100 gross premium, 1250012 fee. Its complete taker-SELL path remains behind
the explicit flag. Other RANGER addresses fail closed. The SDK bigint RANGER
helper uses twice the first wing; this package deliberately uses the supplied
implementation formula instead. No other structure is marked verified by this
fixture.

`feeEstimate = premiumGross × 1250 / 10000` matches all supplied decoded fills;
the notional branch is unverified. The local Referrer Fees export states the
minimum formula without defining notional; the OptionBook ABI exposes accrued
fees and referrer splits, but no fill-fee calculator. `premiumNet` is an estimate,
not a guaranteed credit or an application fee policy.

No network or real fill was performed. Supplied decoded transfers are fixtures,
not independent on-chain verification during this round.
