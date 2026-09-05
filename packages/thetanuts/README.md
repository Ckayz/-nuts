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
- Only PHYSICAL_PUT + aBasUSDC (`0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB`) has supplied decoded taker-SELL evidence. Every other pair requires `allowUnverifiedStructureCollateral: true`; otherwise `STRUCTURE_COLLATERAL_UNVERIFIED` names the pair. Contract units and on-chain collateral/fee/budget rounding outside supplied fills remain UNVERIFIED. The notional fee branch remains UNVERIFIED.
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
premium, and cap metadata. Buy orders throw `INVALID_SIDE`; all pairs except
PHYSICAL_PUT + aBasUSDC require
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

Seller sizing uses `budget × 1e8 / collateralPerContract`. Both collateral per
contract and final collateral required come exclusively from SDK bigint
`utils.calculateCollateral`. Implementation names map to supported payout types;
raw strikes pass unchanged. Size and collateral decimals come from SDK chain
token configuration. Unknown decimals, unsupported mappings (including inverse
calls/spreads), and helper rejections throw `STRUCTURE_UNSUPPORTED` with opt-in.

The RANGER helper uses wing widths, not the inner gap. Tests compare three strike
sets directly against it. PUT + USDC (389926 contracts → 912426840) and RANGER +
USDC (43333 → 43333000) have supplied taker-BUY evidence for maker collateral
only; their taker-SELL debits still require opt-in.

PHYSICAL_PUT is deployed on Base: supplied sell fill `0xdf33…` uses
`0x6aD53DD058bea004829cCf58a282C21a7Df02DcA` with aBasUSDC. This corrects
a blanket physical-implementation exclusion inferred from the teammate's
handover note about seven physical multi-leg implementations; it does not
verify those multi-leg implementations.

`feeEstimate = premiumGross × 1250 / 10000` matches all supplied decoded fills;
the notional branch is unverified. The local Referrer Fees export states the
minimum formula without defining notional; the OptionBook ABI exposes accrued
fees and referrer splits, but no fill-fee calculator. `premiumNet` is an estimate,
not a guaranteed credit or an application fee policy.

No network or real fill was performed. Supplied decoded transfers are fixtures,
not independent on-chain verification during this round.
