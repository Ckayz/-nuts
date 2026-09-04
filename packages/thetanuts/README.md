# @nuts/thetanuts

Framework-neutral Thetanuts OptionBook logic for Base mainnet.

- `createReadClient({ rpcUrl, referrer? })` creates a read-only SDK client with browser-safe memory storage; `assertBaseChain(chainId)` guards wallet chain selection.
- `fetchLiveOrders(client, now?)` fetches API-advertised rows passing local amount and expiry filters; cancellation and minimum-size preflight are not checked. `deriveMarkets(orders, now?)` resolves feed, collateral and implementation metadata. `listAssets`, `listExpiries`, and `listStructures` group results.
- `quoteFill({ client, order, budget, referrer?, allowUnverifiedTakerSell?, now? })` turns collateral-base-unit premium spend into a capped fill quote.
- `premiumUsd8From` converts collateral-base-unit premium to total 8-decimal USD premium; `payoffAtExpiry`, `payoffCurve`, `maxLoss`, `maxPayout`, and `breakEven` calculate vanilla/spread long or short risk from explicit strikes, size, total USD premium, and contract-size decimals.
- `buildFillTransactions({ client, order, budget, referrer?, account, allowUnverifiedTakerSell?, now? })` returns optional exact ERC-20 approval calldata, fill calldata, and expected values. Call `assertBaseChain` separately.
- `parseOrderFilled(logs, { optionBook })` extracts canonical r12 fill fields emitted by the expected OptionBook; `expectOrderFilled(logs, { optionBook, buyer?, seller?, nonce? })` requires exactly one matching fill.
- `getIndexedPositions`, `getOptionState`, and `settledPayout` wrap the supported indexer and on-chain reads.
- `ThetanutsLogicError` exposes stable local error codes and optional details.

## UNVERIFIED

- Contract-size decimals vary ambiguously across the SDK material; every risk call requires a verified `contractSizeDecimals`.
- Maker-buy/taker-sell debit is gated in quoting and fill construction but remains an explicitly allowed advanced path.
- Budget-cap premium rounding must be verified on-chain; quotes deliberately recompute the floored premium.
- The SDK's browser bundle retains `FileStorageProvider` dynamic `fs/promises` imports; the target Next.js client-boundary build is UNVERIFIED.
- ERC-20 approval quirks, minimum/cancellation preflight, and settlement operations remain outside this pure package's guarantees.

No defaults are supplied for budget, fees, slippage, or gas headroom.
