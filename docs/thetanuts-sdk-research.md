Reviewed .research/thetanuts inputs; SHA-256 index.js 9641d4cf9dbee2590d9c9c831e6cf4a90bf37f3535b9266983b32075687707c4, index.d.ts 99135b1f5bb104d15247ab763c47752c9e658a39f7d5012d4865bcfb3d0e3914, docs e194017f31a1eb9c5a9c1a273fd0c5e307c7c2f2e126dddfd34b81f5c491ac65

This is a static analysis of `@thetanuts-finance/thetanuts-client` 0.3.0. The declarations are treated as the public API and the bundled CJS as the behavioral truth; the package identifies those files as its `require` and type exports and identifies the version as 0.3.0 (`sdk/package.json:2-17`). Where the prose docs disagree with those two, this report calls it out. The docs themselves warn that examples are unaudited (`docs-llms-full.txt:107-123`). No network or live-chain assertions were made.

## 1. Client construction, providers, signers, and endpoints

### Exact configuration

`new ThetanutsClient(config)` requires `chainId` and an ethers v6 `Provider`. `signer` is optional. The other public options are `referrer`, `apiBaseUrl`, `indexerApiUrl`, `pricingApiUrl`, `wsUrl`, `stateApiUrl`, `env`, `logger`, `keyStorageProvider`, and `rfqKeyPrefix` (`sdk/dist/index.d.ts:136-163`). The runtime rejects a missing provider, an unsupported chain, and a malformed referrer; `env` defaults to `"prod"`, but it does not select different endpoints—it is only stored while each URL independently falls back to the chain config (`sdk/dist/index.js:16609-16629`, `sdk/dist/index.js:16655-16671`).

The client does **not** create a provider from `chainConfig.defaultRpcUrls`; the caller must create and pass one. The two configured Base RPC suggestions are metadata only: `https://mainnet.base.org` and `https://base.llamarpc.com` (`sdk/dist/index.js:170-178`, `sdk/dist/index.js:16614-16616`). Every HTTP client uses a 30-second timeout and JSON content type (`sdk/dist/index.js:16623-16629`, `sdk/dist/index.js:12190-12200`).

### Browser read-only construction

There is a material v0.3.0 browser-construction trap. The client eagerly constructs `rfqKeys`; in a browser, its default-storage selector intentionally throws unless `keyStorageProvider` is explicit (`sdk/dist/index.js:16636-16650`, `sdk/dist/index.js:11712-11729`). Therefore the simpler browser examples in the docs (`docs-llms-full.txt:9091-9107`) are not runnable as written. Thesis.fun does not use RFQ, so an in-memory provider is the least-privilege workaround:

```ts
import {
  MemoryStorageProvider,
  ThetanutsClient,
} from "@thetanuts-finance/thetanuts-client";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);

export const thetanuts = new ThetanutsClient({
  chainId: 8453,
  provider,
  keyStorageProvider: new MemoryStorageProvider(), // required in browser v0.3.0
});
```

`MemoryStorageProvider` is exported and loses keys when the process/page ends, which is harmless only because this app will not create sealed-bid RFQs (`sdk/dist/index.d.ts:73-85`, `sdk/dist/index.d.ts:14833`). Do not opt into `LocalStorageProvider` merely to silence the constructor: it stores RFQ private keys in plaintext and explicitly warns about same-origin/XSS exposure (`sdk/dist/index.d.ts:87-106`).

### Ethers-connected browser wallet

If an app wants the SDK's write methods, wrap the injected EIP-1193 provider and pass its ethers signer:

```ts
import { MemoryStorageProvider, ThetanutsClient } from
  "@thetanuts-finance/thetanuts-client";
import { ethers } from "ethers";

const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();
const clientWithSigner = new ThetanutsClient({
  chainId: 8453,
  provider,
  signer,
  referrer: REFERRER_ADDRESS,
  keyStorageProvider: new MemoryStorageProvider(),
});
```

That is the documented MetaMask construction shape (`docs-llms-full.txt:9129-9143`), with the required browser storage fix added. Before SDK write calls, `assertNetwork()` checks both the configured provider and the signer's attached provider against chain 8453 (`sdk/dist/index.js:16699-16717`).

For Thesis.fun's wagmi/viem architecture, prefer the read-only client plus the encode methods in section 3. No ethers signer adapter is necessary. The SDK's external-wallet methods intentionally return calldata for viem/wagmi/AA wallets (`sdk/dist/index.d.ts:2027-2057`).

### Default Base endpoints and override behavior

| Purpose | Client property / option | Base r12 default |
|---|---|---|
| JSON-RPC | caller-created ethers `provider`; no URL option | no constructed default; config suggests `https://mainnet.base.org`, then `https://base.llamarpc.com` |
| Order aggregation + market data | `apiBaseUrl` | `https://round-snowflake-9c31.devops-118.workers.dev` |
| Book positions/history/stats | `indexerApiUrl` | `https://indexer.thetanuts.finance/api/v1/book` |
| MM option pricing | `pricingApiUrl` | `https://pricing.thetanuts.finance` |
| Realtime | `wsUrl` → `wsBaseUrl` | `wss://ws.thetanuts.finance/v4` |
| RFQ/Factory state | `stateApiUrl` | `https://indexer.thetanuts.finance` |

These exact defaults are bundled at `sdk/dist/index.js:170-178`; the constructor's one-for-one override logic is at `sdk/dist/index.js:16618-16622`. All five service URLs can be replaced independently:

```ts
const client = new ThetanutsClient({
  chainId: 8453,
  provider: new ethers.JsonRpcProvider(PRIVATE_BASE_RPC),
  keyStorageProvider: new MemoryStorageProvider(),
  apiBaseUrl: "https://orders.example",
  indexerApiUrl: "https://indexer.example/api/v1/book",
  pricingApiUrl: "https://pricing.example",
  stateApiUrl: "https://state.example",
  wsUrl: "wss://ws.example",
});
```

The URL-override form is also documented (`docs-llms-full.txt:9157-9169`). Note the different concatenation expectations: ordinary API calls use Axios's `baseURL`; indexer and state calls manually concatenate the configured base with their endpoint (`sdk/dist/index.js:2546-2565`, `sdk/dist/index.js:2790-2795`). Avoid a trailing slash unless the replacement server tolerates double slashes.

## 2. OptionBook reads and deriving the live market universe

### Fetching all available maker orders

The public method is exactly:

```ts
const orders: OrderWithSignature[] = await client.api.fetchOrders();
```

Its declaration is `fetchOrders(): Promise<OrderWithSignature[]>` (`sdk/dist/index.d.ts:2311-2326`). At runtime it performs `GET /` against `apiBaseUrl`, accepts either `response.data.orders` or `response.orders`, and normalizes every row (`sdk/dist/index.js:2584-2589`). The docs describe these as all currently available orders and recommend a fresh fetch immediately before execution because a row may expire or be consumed between polls (`docs-llms-full.txt:192-220`, `docs-llms-full.txt:2075-2092`). There is no pagination argument or on-chain order enumeration method in this API.

The raw service row is a signed envelope containing `order`, top-level `nonce`, `signature`, and optional `optionBookAddress`; the raw `order` contains maker, collateral, call flag, price feed, implementation, strikes, option expiry, price, max collateral, maker direction, order expiry, requested fill size, and extra data (`docs-llms-full.txt:222-251`).

### Authoritative normalized shape

```ts
interface OrderWithSignature {
  order: {
    maker: string;
    taker: string;               // normalized to zero address
    option: string;              // "" before fill
    isBuyer: boolean;            // maker-is-buyer
    numContracts: bigint;
    price: bigint;               // 8 decimals
    expiry: bigint;              // option Unix time, seconds
    nonce: bigint;
    optionType?: number;         // 0 call, 1 put in this normalizer
    strikes?: bigint[];          // 8 decimals
    strikePrice?: bigint;        // deprecated, first strike only
    collateralToken?: string;
    underlyingToken?: string;
    deadline?: bigint;
  };
  signature: string;
  availableAmount: bigint;       // maker collateral budget
  makerAddress: string;
  rawApiData?: {
    collateral: string;
    priceFeed: string;
    implementation: string;
    strikes: string[];            // integer strings, 8 decimals
    isCall: boolean;
    isLong: boolean;              // true means maker sells
    orderExpiryTimestamp: number; // order Unix time, seconds
    extraOptionData: string;
    maxCollateralUsable: string;  // collateral-token base units
    optionBookAddress?: string;
    greeks?: {
      delta: number;
      iv: number;
      gamma: number;
      theta: number;
      vega: number;
    };
  };
}
```

The `Order`, raw metadata, and envelope fields are authoritative in `sdk/dist/index.d.ts:731-806` and `sdk/dist/index.d.ts:1165-1212`. Normalization sets `isBuyer = !isLong`, maps strikes/price/amounts to bigint, makes the option address empty before deployment, and copies `maxCollateralUsable` to `availableAmount` (`sdk/dist/index.js:3346-3403`). Do not copy the docs' sample accesses `o.order.availableAmount`, `o.order.isBuy`, `rawApiData.underlying`, or bigint `rawApiData.strikes`: none exists in the declaration (`docs-llms-full.txt:2094-2113`).

`underlyingToken` is not a safe asset identifier. The normalizer has a hardcoded mapping for only BTC and ETH feeds and maps everything else to the zero address (`sdk/dist/index.js:2520-2530`). Use the price-feed symbol map instead.

### Derive assets, expiries, strikes, sides, collateral, and structures from liquidity

This derives the UI universe from fetched orders, never from a BTC/ETH allow-list:

```ts
import {
  buildPriceFeedSymbolMap,
  getOptionImplementationInfo,
  type OrderWithSignature,
} from "@thetanuts-finance/thetanuts-client";

const feedToSymbol = buildPriceFeedSymbolMap(8453);
const now = BigInt(Math.floor(Date.now() / 1_000));

const live = (await client.api.fetchOrders()).filter((row) => {
  const raw = row.rawApiData;
  return raw !== undefined &&
    row.availableAmount > 0n &&
    row.order.expiry > now &&
    BigInt(raw.orderExpiryTimestamp) > now;
});

const markets = live.map((row) => {
  const raw = row.rawApiData!;
  return {
    asset: feedToSymbol[raw.priceFeed.toLowerCase()] ??
      `UNKNOWN_FEED:${raw.priceFeed}`,
    priceFeed: raw.priceFeed,
    strikes: raw.strikes.map(BigInt),
    expiry: row.order.expiry,
    side: raw.isCall ? "call" as const : "put" as const,
    makerSide: raw.isLong ? "seller" as const : "buyer" as const,
    collateral: raw.collateral,
    implementation: getOptionImplementationInfo(8453, raw.implementation),
    row,
  };
});

const assets = new Set(markets.map((x) => x.asset));
const expiries = new Set(markets.map((x) => x.expiry.toString()));
const strikes = new Set(markets.flatMap((x) => x.strikes.map(String)));
const collaterals = new Set(markets.map((x) => x.collateral.toLowerCase()));
```

`buildPriceFeedSymbolMap` reverses every non-legacy `chainConfig.priceFeeds` entry and `getOptionImplementationInfo` performs case-insensitive historical/current reverse lookup (`sdk/dist/index.js:285-298`). Preserve unknown feed and implementation addresses as first-class UI values; dropping them would violate the “every market with liquidity” requirement.

### Server-side filtering caveat

`filterOrders` is declared with `{ asset?, type?: "call" | "put", collateral?, minExpiry?, maxExpiry? }` (`sdk/dist/index.d.ts:1214-1227`, `sdk/dist/index.d.ts:2343-2356`). It calls `GET /orders` with `asset`, `type`, `collateral`, `min_expiry`, and `max_expiry` (`sdk/dist/index.js:2639-2650`). However it uses the older `normalizeOrder()` path, which does not attach `rawApiData` (`sdk/dist/index.js:3325-3332`), so its results cannot be fed to `previewFillOrder`/`fillOrder`. The docs instead show a nonexistent `isCall` filter (`docs-llms-full.txt:2117-2138`). For this app, use `fetchOrders()` and client-side predicates.

## 3. Preview, approval, fill, and viem transactions

### Exact method signatures

```ts
client.optionBook.previewFillOrder(
  order: OrderWithSignature,
  usdcAmount?: bigint,
  referrer?: string,
): {
  numContracts: bigint;
  maxContracts: bigint;
  collateralToken: string;
  pricePerContract: bigint;
  totalCollateral: bigint;
  referrer: string;
  maker: string;
  expiry: bigint;
  isCall: boolean;
  strikes: bigint[];
};

await client.optionBook.fillOrder(
  order: OrderWithSignature,
  usdcAmount?: bigint,
  referrer?: string,
): Promise<ethers.TransactionReceipt>;

client.optionBook.encodeFillOrder(
  order: OrderWithSignature,
  usdcAmount?: bigint,
  referrer?: string,
): { to: string; data: string };
```

Those are the declaration signatures (`sdk/dist/index.d.ts:1991-2002`, `sdk/dist/index.d.ts:2025-2057`). Despite the parameter name, `usdcAmount` is used for non-USDC orders too.

### What the amount means—and what preview really returns

There are two different budgets:

1. `order.availableAmount` / `maxCollateralUsable` is the **maker's remaining collateral budget**, in the collateral token's native decimals, not a number of contracts (`sdk-context-llms.js:698-700`). The SDK converts it to `maxContracts` using strike/width/collateral formulas (`sdk/dist/index.js:1645-1694`).
2. The optional `usdcAmount` argument is a **taker spend/premium budget**, not a requested contract count. The bundle computes `numContracts = amount × 1e8 / pricePerContract` (`sdk/dist/index.js:1625-1633`, `sdk/dist/index.js:1717-1727`). The docs themselves call the example “a specific premium amount,” although their parameter table then confusingly calls it collateral (`docs-llms-full.txt:2506-2524`).

The local preview does not contact the chain and does not reproduce all contract validity checks. Its returned `totalCollateral` is literally assigned the local variable `totalPremium`; when a spend amount was supplied it returns that original amount even if `numContracts` was capped at `maxContracts` (`sdk/dist/index.js:1713-1740`). Therefore:

- `numContracts`, `maxContracts`, price, token, resolved referrer, maker, expiry, call flag, and strikes are returned.
- Premium/spend is exposed under the misleading name `totalCollateral`.
- **Neither `maxLoss` nor `maxPayout` is returned.** The docs' claim that preview is exact on-chain collateral math is stronger than the implementation (`docs-llms-full.txt:2467-2475`).
- If the supplied budget exceeds available size, recompute actual premium as `preview.numContracts * preview.pricePerContract / 100_000_000n`; do not approve the uncapped `preview.totalCollateral` blindly.

For a payoff/risk panel, use the implementation-aware pure payout utilities with explicit decimal parameters, then confirm after deployment with `client.option.calculateRequiredCollateral` / `simulatePayout`; those methods return collateral/payout in collateral decimals (`sdk/dist/index.d.ts:6500-6535`, `sdk/dist/index.d.ts:6637-6683`, `sdk/dist/index.d.ts:5050-5077`). Because OptionBook contract-size decimals are internally inconsistent in the supplied material (section 9), pre-trade max loss/max payout is **UNVERIFIED** until tested against `OptionBook.getValidNumContracts` and the deployed implementation.

### Exact approval and external-wallet flow

The ordinary `fillOrder` ABI is nonpayable and returns the deployed option address; the encoded SDK result has only `to` and `data`, not a native `value` (`sdk/dist/index.js:1374-1388`, `sdk/dist/index.d.ts:900-908`, `docs-llms-full.txt:2985-3010`). For viem, set `value: 0n` only as a local transaction field. The token is `preview.collateralToken`; the spender is the canonical OptionBook returned as `encodedFill.to`; the approval unit is that token's smallest unit. `encodeApprove` itself is `(token, spender, amount) => {to,data}` (`sdk/dist/index.d.ts:639-666`).

```ts
import { parseEventLogs, type Address, type Hex } from "viem";
import { OPTION_BOOK_ABI } from "@thetanuts-finance/thetanuts-client";

const freshOrder = (await client.api.fetchOrders()).find(matchesSelection);
if (!freshOrder) throw new Error("Order is no longer available");

const spend = client.utils.toBigInt(userBudget, collateralDecimals);
const preview = client.optionBook.previewFillOrder(
  freshOrder,
  spend,
  REFERRER_ADDRESS,
);

const actualPremium =
  preview.numContracts * preview.pricePerContract / 100_000_000n;

// v0.3.0 does not expose the taker collateral requirement for maker-buy rows.
// Until live verification, only enable this premium-approval flow when the
// maker is selling and the taker is buying.
if (!freshOrder.rawApiData!.isLong) {
  throw new Error("Taker-sell collateral requirement is UNVERIFIED");
}

const fill = client.optionBook.encodeFillOrder(
  freshOrder,
  actualPremium,
  REFERRER_ADDRESS,
);

// Verify wallet chain before both sends; encodeFillOrder does not assert it.
if (walletClient.chain?.id !== 8453) throw new Error("Switch to Base");

const currentAllowance = await client.erc20.getAllowance(
  preview.collateralToken,
  account,
  fill.to,
);

if (currentAllowance < actualPremium) {
  const approval = client.erc20.encodeApprove(
    preview.collateralToken,
    fill.to,
    actualPremium,
  );
  const approvalHash = await walletClient.sendTransaction({
    account,
    chain: base,
    to: approval.to as Address,
    data: approval.data as Hex,
    value: 0n,
  });
  await publicClient.waitForTransactionReceipt({ hash: approvalHash });
}

const gas = await publicClient.estimateGas({
  account,
  to: fill.to as Address,
  data: fill.data as Hex,
  value: 0n,
});
const fillHash = await walletClient.sendTransaction({
  account,
  chain: base,
  to: fill.to as Address,
  data: fill.data as Hex,
  value: 0n,
  gas: gas * 120n / 100n,
});

const receipt = await publicClient.waitForTransactionReceipt({ hash: fillHash });
const [filled] = parseEventLogs({
  abi: OPTION_BOOK_ABI,
  logs: receipt.logs,
  eventName: "OrderFilled",
  strict: true,
});
const optionAddress = filled?.args.optionAddress as Address | undefined;
if (!optionAddress) throw new Error("OrderFilled log missing");
```

The docs likewise prescribe collateral token → OptionBook approval before the fill (`docs-llms-full.txt:3075-3098`), and the SDK never auto-approves (`docs-llms-full.txt:2781-2786`). Use the actual order collateral address rather than hardcoding USDC. For a maker-buy/taker-sell row, economic collateral can exceed premium; because the local preview does not expose that taker debit, block the direction until `getValidNumContracts(...).collateralRequired` and the actual transfer behavior are verified. Some ERC-20s require zeroing a nonzero allowance before changing it; `ensureAllowance` does only a direct approval, so the UI should handle a failure with an approve-zero then approve-exact fallback (**UNVERIFIED for the eight configured Base tokens**).

`encodeFillOrder` validates raw order data and a supplied referrer, calculates/caps size, copies the signed fields, and encodes `fillOrder`; it does **not** check either expiry or the connected network (`sdk/dist/index.js:1860-1889`). The signer-based `fillOrder` checks both option expiry and the signed order-expiry timestamp, asserts the network, estimates gas with 20% headroom, submits, and waits for the receipt (`sdk/dist/index.js:1764-1830`). Reproduce those preconditions around an external-wallet send.

Although the ABI declares an `optionAddress` return, an already-sent transaction does not expose Solidity return data in its receipt, and the SDK's signer wrapper returns only the receipt. Persist the option address from the canonical `OrderFilled` log. Its r12 fields are `nonce`, indexed `buyer`, indexed `seller`, `optionAddress`, `premiumAmount`, `feeCollected`, `referrer`, `referralFeePaid`, and `sellerWasMaker` (`sdk/dist/index.js:1453-1467`). Do **not** use `client.events.getOrderFillEvents()` for this: its declaration and normalizer still expect the obsolete `maker/taker/option/numContracts/price` layout (`sdk/dist/index.d.ts:5385-5407`, `sdk/dist/index.js:9150-9175`).

The API-supplied `optionBookAddress` cannot redirect approval/fill: if present, the SDK requires it to equal the chain-configured canonical book (`sdk/dist/index.js:1562-1582`). This also means historical orders signed for an older book are not fillable through this client even though historical implementation addresses remain decodable.

### Preflight and swap encode methods

`callStaticFillOrder(order, amount?, referrer?)` returns `{ success, returnValue?, error?, gasEstimate, gasLimitWithBuffer }`, not the docs' `{ok,value}` union (`sdk/dist/index.d.ts:469-480`, `docs-llms-full.txt:2594-2614`). It requires an ethers signer even though it is simulation, because the implementation constructs a signer-connected contract (`sdk/dist/index.js:2407-2463`). For the no-signer viem path, use `publicClient.call`/`estimateGas` with `account` and the encoded transaction.

The other external-wallet fill helper is:

```ts
const tx = client.optionBook.encodeSwapAndFillOrder(
  order,
  swapRouter,
  swapSourceToken,
  swapSourceAmount,
  swapCalldata,
  referrer,
); // {to, data}; no value
```

It always fills `calculateMaxContracts(order)`; there is no taker budget/desired-contract parameter (`sdk/dist/index.js:2133-2156`). The docs say the source token must be approved to the swap router (`docs-llms-full.txt:2703-2731`), but that allowance direction was not independently proven by the ABI in these inputs. Avoid this path for v1 until verified live.

## 4. Multi-leg OptionBook orders

A multi-leg trade is one signed `ContractOrder`, one implementation address, one shared `numContracts`, and an ordered `strikes[]`; it is not a list of independently filled legs. The exact signed struct carries `implementation`, `strikes`, and `extraOptionData` alongside the ordinary collateral/price/feed/direction fields (`sdk/dist/index.d.ts:731-762`). `previewFillOrder`, `encodeFillOrder`, and `fillOrder` use the same calls for every structure (`docs-llms-full.txt:2228-2245`).

```ts
const info = getOptionImplementationInfo(
  8453,
  order.rawApiData!.implementation,
);
if (!info) throw new Error("Unknown implementation; do not guess payoff");
if (order.rawApiData!.strikes.length !== info.numStrikes) {
  throw new Error("Implementation/strike-count mismatch");
}

const preview = client.optionBook.previewFillOrder(order, spend, referrer);
const encoded = client.optionBook.encodeFillOrder(order, spend, referrer);
```

Strike count gives a coarse family—1 vanilla, 2 spread, 3 butterfly, 4 condor/iron-condor/ranger—but only the implementation lookup distinguishes all four-strike payoffs and inverse/linear calls (`sdk/dist/index.d.ts:784-794`, `sdk/dist/index.js:152-166`). Do not use the docs' example `impl.includes('iron')`: an implementation is a hex address (`docs-llms-full.txt:2370-2379`).

The pure payout utilities require structure-specific strike ordering and invariants: call/put spreads ascending; call fly ascending; put fly descending; condors ascending/equal wings; iron condor ascending/non-overlapping; ranger four strikes with equal call/put widths and separated zones (`sdk/dist/index.d.ts:6480-6500`). Preserve the order exactly as signed for the fill; only transform a copy for display or a utility that explicitly demands another order.

The SDK's `calculateMaxContracts` handles two strikes by absolute width, but for every structure with three or more strikes it uses `max(strikes) - min(strikes)` (`sdk/dist/index.js:1668-1691`). That is deliberately described as `maxSpread` in the docs (`docs-llms-full.txt:2477-2485`), but it is not the ordinary wing-width maximum payout of a butterfly/condor. Treat max sizing for 3/4-leg structures as **UNVERIFIED** and preflight against the contract's `getValidNumContracts(implementation,strikes,desiredContracts)`, whose exported ABI returns `{validContracts,collateralRequired}` (`sdk/dist/index.js:1287-1307`). The `OptionBookModule` has no typed wrapper for that ABI entry in the declarations, so a viem `readContract` with the exported `OPTION_BOOK_ABI` is needed.

## 5. Positions, live P&L, settlement, and closing

### Discover via indexer; verify known positions on-chain

The supported wallet-level OptionBook query is indexer-backed:

```ts
const open = await client.api.getUserPositionsFromIndexer(walletAddress);
const history = await client.api.getUserHistoryFromIndexer(walletAddress);
const one = await client.api.getBookOption(optionAddress);
```

The declarations distinguish these as Book API methods (`sdk/dist/index.d.ts:2280-2297`, `sdk/dist/index.d.ts:2358-2383`), and the runtime requests `/user/{address}/positions` and `/user/{address}/history` under `indexerApiUrl` (`sdk/dist/index.js:2666-2693`). The docs' endpoint-status table marks both endpoints working (`docs-llms-full.txt:10762-10769`). These are off-chain indexed views, not RPC reads.

There is no `getPositionsByWallet()` on-chain enumerator in `OptionModule`. Once an option address is known, the following are direct RPC reads from that option proxy:

```ts
const info = await client.option.getFullOptionInfo(optionAddress);
const [buyer, seller, contracts, collateral, settled, twap, twapPeriod] =
  await Promise.all([
    client.option.getBuyer(optionAddress),
    client.option.getSeller(optionAddress),
    client.option.getNumContracts(optionAddress),
    client.option.getCollateralAmount(optionAddress),
    client.option.isSettled(optionAddress),
    client.option.getTWAP(optionAddress),
    client.option.getTwapPeriod(optionAddress),
  ]);
```

The declarations expose these reads and identify TWAP as 8-decimal (`sdk/dist/index.d.ts:5079-5208`). `getFullOptionInfo` returns nullable fields because older/incompatible proxies can fail individual calls (`sdk/dist/index.d.ts:4873-4891`). To discover every wallet position without trusting the hosted indexer, index the canonical ABI's `OrderFilled` logs from the deployment block, take `optionAddress` from each log, and verify `buyer()`/`seller()` on each proxy. The SDK EventsModule cannot be used here because its r12 normalizer still reads obsolete event field names (`sdk/dist/index.js:1453-1467`, `sdk/dist/index.js:9150-9175`); the old integration guide itself recommends self-indexing for production (`docs-llms-full.txt:474-476`).

### Full normalized `Position` shape

```ts
interface Position {
  id: string;
  optionAddress: string;
  side: "buyer" | "seller";
  amount: bigint;
  entryPrice: bigint;
  currentValue: bigint;
  pnl: bigint;
  option: {
    underlying: string;
    collateral: string;
    strikes: bigint[];
    expiry: number;
    optionType: number;
  };
  status: string;
  buyer: string;
  seller: string;
  referrer: string;
  createdBy: string;
  entryTimestamp: bigint;
  entryTxHash: string;
  entryBlock: bigint;
  entryFeePaid: bigint;
  collateralAmount: bigint;
  collateralSymbol: string;
  collateralDecimals: number;
  priceFeed: string;
  closeTimestamp: bigint;
  closeTxHash: string;
  closeBlock: bigint;
  optionTypeRaw: number;
  explicitClose: boolean;
  settlement?: {
    settlementPrice: bigint;
    payoutBuyer: bigint;
    collateralReturnedSeller: bigint;
    exercised: boolean;
    deliveryAmount: bigint;
    deliveryCollateral: bigint;
    explicitDecision: boolean;
    oracleFailure: boolean;
    oracleFailureReason: string;
  };
  optionStatus?: "active" | "closed" | "expired-awaiting-settlement" |
    "settled-itm" | "settled-otm";
  pnlEntries?: PositionPnL[];
  pnlUsd?: string | null;          // documented as 8 decimals
  pnlPct?: string | null;
  implementationName?: string;
  implementationType?: string;
  bookAddress?: string;
}
```

The complete public fields are declared at `sdk/dist/index.d.ts:1231-1329`; the P&L-entry subfields are at `sdk/dist/index.d.ts:1848-1871`. Normalization accepts both nested and legacy flat indexer rows, bigint-converts monetary fields, and defaults absent `currentValue` and `pnl` to zero (`sdk/dist/index.js:3416-3496`). Consequently zero is ambiguous between “actually zero” and “indexer omitted it”; do not display it as live P&L without freshness/provenance metadata.

### Live mark and P&L

`client.mmPricing` obtains executable-style MM bid/ask/mark data from `GET {pricingApiUrl}/all`, honoring the response cache TTL (`sdk/dist/index.js:12190-12227`). Vanilla rows include raw bid/ask, adjusted bid/ask, mark, spot, expiry, and collateral-specific bid/ask/carry breakdowns (`sdk/dist/index.d.ts:7176-7206`, `sdk/dist/index.d.ts:7252-7282`). Spread, butterfly, and condor calls expose net bid/ask and collateral/max-loss fields (`sdk/dist/index.d.ts:7320-7430`, `sdk/dist/index.d.ts:7564-7588`).

```ts
const impl = getOptionImplementationInfo(8453, implementationAddress);
const symbol = buildPriceFeedSymbolMap(8453)[priceFeed.toLowerCase()];

// Vanilla only; this function accepts ETH/BTC ticker formats only.
const ticker = buildTicker(symbol, expirySeconds, strike8dp, isCall);
const quote = await client.mmPricing.getTickerPricing(ticker);
const collateralClass = collateralSymbol === "USDC" ? "USD" : symbol;
const mark = quote.byCollateral[collateralClass];

// Economic convention (inference): mark longs at bid and shorts at ask.
const exitUnitUnderlying = side === "buyer"
  ? mark.mmBidPrice
  : mark.mmAskPrice;
```

The conversion from these floating-point underlying-denominated prices to the position's collateral token, and whether to use raw, adjusted, or buffered quotes, is **not specified for portfolio accounting**. An economically conservative inference is buyer liquidation value at bid and seller liability at ask; then buyer P&L = current exit value − entry premium − entry fee, while seller P&L = premium received − current buyback liability − fee. But the SDK provides no Position→MM-ticker/P&L method, and `entryPrice` normalizes the indexer's `entryPremium`, which may be total rather than per-contract (`sdk/dist/index.js:3433-3459`). Treat that local formula as **UNVERIFIED**.

More importantly, MM ticker parsing and `getAllPricing` accept only ETH/BTC (`sdk/dist/index.js:12078-12127`, `sdk/dist/index.d.ts:7518-7529`). Thus MM pricing cannot supply live P&L for every OptionBook price feed (SOL, DOGE, XRP, BNB, PAXG, AVAX are configured). For the initial app, store the fill premium/fee on-chain facts, label indexer/MM marks as indicative, and leave P&L unavailable when no matched quote exists.

### Settled payoff and settlement lifecycle

For a known deployed option, the authoritative payoff calculation is an on-chain view:

```ts
const settlementPrice = await client.option.getTWAP(optionAddress); // 8 dp
const { payout } = await client.option.calculatePayout(
  optionAddress,
  settlementPrice,
); // collateral-token base units

// Or verify arbitrary inputs against the deployed implementation:
const simulated = await client.option.simulatePayout(
  optionAddress,
  settlementPrice,
  await client.option.getStrikes(optionAddress),
  await client.option.getNumContracts(optionAddress),
);
```

The bundle calls the proxy's `getTWAP()` and `calculatePayout(uint256)` directly (`sdk/dist/index.js:7818-7835`, `sdk/dist/index.js:8153-8176`). The option stores its Chainlink price feed and historical TWAP consumer, and exposes both addresses (`sdk/dist/index.d.ts:5182-5208`). `settlementPrice` is 8-decimal; calculated payout is in collateral-token units (`sdk/dist/index.d.ts:5050-5077`, `sdk/dist/index.d.ts:6637-6655`).

For settled P&L, use indexed settlement facts when available:

- buyer cash P&L = `settlement.payoutBuyer - entryPremium - entryFeePaid`;
- seller cash P&L = `entryPremium - (collateralAmount - collateralReturnedSeller) - sellerFee`;
- never count returned principal collateral as profit.

Those formulas are accounting inferences; exact fee direction and whether `entryPremium` is gross/net are **UNVERIFIED**. The indexer explicitly supplies `payoutBuyer`, `collateralReturnedSeller`, and a settlement price (`sdk/dist/index.d.ts:1231-1249`), and the legacy response guide says settlement price is 8 dp and buyer payout is collateral decimals (`docs-llms-full.txt:538-547`).

Who triggers r12 settlement is clearer in the bundle than in the docs: `client.option.payout()` is retained only for compatibility and always throws `INVALID_PARAMS`; r12 removed the user-callable payout entrypoint, with settlement triggered automatically via the factory's `notifyTradeSettled` callback (`sdk/dist/index.js:7675-7703`). The old position guide saying either party calls `payout()` is stale (`docs-llms-full.txt:7736-7753`). The older OptionBook guide says Thetanuts processes settlement daily (`docs-llms-full.txt:113-123`), but these inputs do not specify the keeper, exact post-expiry delay, TWAP window, fallback behavior, or callback transaction. Those remain live-verification questions.

### Early close

```ts
// ethers-signer path only
const result = await client.option.close(optionAddress);
await result.wait();
```

`close(address)` simply calls the option's zero-argument `close()`; there is no price, amount, signature, or swap quote in the SDK call (`sdk/dist/index.js:7508-7538`). The docs call it a bilateral close requiring buyer and seller agreement (`docs-llms-full.txt:7720-7734`). This is not an OptionBook “sell back” or market close; the inputs do not explain the bilateral authorization sequence or economic consideration. Splitting and transferring roles exist, but they likewise do not create liquidity (`sdk/dist/index.d.ts:4962-4986`, `sdk/dist/index.d.ts:5134-5159`).

## 6. Referrer fees

Referrer resolution order is per-fill argument → client-level `referrer` → zero address; the encode and signer paths both place the resolved address into the `fillOrder` calldata (`sdk/dist/index.js:1727-1739`, `sdk/dist/index.js:1877-1888`).

```ts
const client = new ThetanutsClient({
  chainId: 8453,
  provider,
  referrer: THESIS_FUN_REFERRER,
  keyStorageProvider: new MemoryStorageProvider(),
});

// Default referrer:
const tx1 = client.optionBook.encodeFillOrder(order, spend);
// Override for this fill:
const tx2 = client.optionBook.encodeFillOrder(order, spend, anotherReferrer);
```

The protocol owner must whitelist the referrer and set its bps split. The documented OptionBook fee is `min(0.06% of notional, 12.5% of premium)`, and the whitelisted share is `fee × feeBps / 10_000`; accrual is per collateral token (`docs-llms-full.txt:2797-2808`). Verify the formula live because this report did not execute contract code.

Read and signer-claim methods are:

```ts
const splitBps = await client.optionBook.getReferrerFeeSplit(referrer);
const amount = await client.optionBook.getFees(collateralToken, referrer);
const all = await client.optionBook.getAllClaimableFees(referrer);

// Requires ethers signer; claims msg.sender's ledger for this token.
const receipt = await client.optionBook.claimFees(collateralToken);
const results = await client.optionBook.claimAllFees();
```

The signer requirements and method summary are documented at `docs-llms-full.txt:2855-2961`. `claimAllFees` performs sequential transactions and records partial failures (`sdk/dist/index.js:2007-2056`). There is no `encodeClaimFees` external-wallet helper in the authoritative exported declarations; a viem app must encode `claimFees(address)` using exported `OPTION_BOOK_ABI` or a minimal ABI, with `to = client.chainConfig.contracts.optionBook` and `value = 0n`.

`getAllClaimableFees` is broader than its description: the implementation scans `chainConfig.tokens`, which includes Aave-wrapped and cbDOGE/cbXRP tokens, not only the legacy three primary collateral tokens (`sdk/dist/index.js:24-64`, `sdk/dist/index.js:1932-1969`). Prefer checking the set of collateral addresses observed in live orders.

OptionFactory/RFQ referral IDs and fees are a different ledger and only the contract owner can withdraw them; they are not OptionBook self-claims (`docs-llms-full.txt:2803-2808`).

## 7. Market data, prices, Greeks/IV, and WebSockets

### Order API market data

```ts
const snapshot = await client.api.getMarketData();
// { prices: Record<string, number>, metadata: {lastUpdated, currentTime} }

const prices = await client.api.getMarketPrices();
// Record<string, {price: bigint, change24h: number, timestamp: number}>
```

`getMarketData()` reads the `market_data` bundled with `GET /`, seeds ETH/BTC/SOL/XRP/BNB/AVAX with zero if absent, and preserves any additional keys (`sdk/dist/index.js:2604-2623`); its number-valued response type is at `sdk/dist/index.d.ts:1441-1475`. `getMarketPrices()` calls `GET /prices` and normalizes rows (`sdk/dist/index.js:2780-2787`, `sdk/dist/index.d.ts:2421-2431`). The scale of `MarketPrice.price: bigint` is not documented in the declarations; mark it **UNVERIFIED** and prefer `getMarketData()` for human display until a live response is captured.

For chain-verifiable feed identity, use `chainConfig.priceFeeds`/`buildPriceFeedSymbolMap`. The SDK does not expose a general Chainlink `latestRoundData` wrapper; once an option exists, it exposes the option's feed address and TWAP read (`sdk/dist/index.d.ts:5182-5208`).

### Option pricing and IV

```ts
const allEth = await client.mmPricing.getAllPricing("ETH");
const vanilla = await client.mmPricing.getTickerPricing("ETH-16FEB26-1800-P");
const spread = await client.mmPricing.getSpreadPricing({
  underlying: "ETH",
  strikes: [1800_00000000n, 2000_00000000n],
  expiry,
  isCall: false,
  numContracts: 1_000000000000000000n,
});
```

The MM endpoint is `GET /all`; raw records contain bid, ask, mark, underlying spot, strike, and `passesToleranceCheck`—**not IV or Greeks** (`sdk/dist/index.d.ts:7174-7206`, `sdk/dist/index.js:12212-12227`). It is restricted by types and ticker parser to ETH/BTC (`sdk/dist/index.d.ts:7529-7545`, `sdk/dist/index.js:12078-12127`). The fee adjustment actually used is `min(0.0004, price × 0.125)` on each side (`sdk/dist/index.js:12138-12147`).

IV and Greeks are available only as optional enrichment on fetched orders: `{delta, iv, gamma, theta, vega}` (`sdk/dist/index.d.ts:1189-1196`). The docs interpret `iv` as a 0–1 fraction and theta per day, while warning that Greeks may be absent near expiry/illiquidity (`docs-llms-full.txt:2181-2196`). There is no public method for a complete arbitrary-asset IV surface despite the docs' `pricingApiUrl` label.

`getPositionPricing` is RFQ-oriented. Its type requires a raw integer `number` contract count and only `USDC | WETH | cbBTC`; the docs example incorrectly passes bigint (`sdk/dist/index.d.ts:7284-7317`, `sdk/dist/index.d.ts:7553-7560`). Runtime calls `BigInt(params.numContracts)`, so fractions throw (`sdk/dist/index.js:12383-12427`). Do not use it directly with scaled OptionBook `numContracts`.

### WebSocket protocol and exact public API

Subscription types are `orders | positions | prices | trades | quotations`. Options carry `type` plus optional `asset`, `address`, and arbitrary primitive `filters`. Wire envelopes are `{type: subscribe|unsubscribe|update|error|ping|pong, subscription?, data?, error?, timestamp?}` (`sdk/dist/index.d.ts:6000-6039`). Exact update payloads are:

- order: event `new|update|fill|cancel|expire`, orderId, optional `{maker,option,numContracts,price,expiry}`, optional fill `{taker,amount,txHash}`, timestamp;
- price: `{asset,price:string,change24h,timestamp}`;
- position: event `open|close|update`, positionId, optionAddress, owner, side, amount, optional currentValue/pnl, timestamp;
- trade: tradeId, txHash, optionAddress, maker, taker, amount, price, timestamp;
- quotation: event `created|offer_made|offer_revealed|settled|cancelled`, quotationId, optional actors/option, timestamp.

These structures are declared verbatim at `sdk/dist/index.d.ts:6041-6139`.

```ts
await client.ws.connect();

const stopOrders = client.ws.subscribeOrders((u) => console.log(u));
const stopPrices = client.ws.subscribePrices((u) => console.log(u), "ETH");
const stopMine = client.ws.subscribePositions((u) => console.log(u), wallet);
const stopTrades = client.ws.subscribeTrades((u) => console.log(u));

console.log(client.ws.state, client.ws.isConnected);

// generic form; return value is an unsubscribe function
const stop = client.ws.subscribe(
  { type: "orders", filters: { implementation: implAddress } },
  handler,
);

stop(); stopOrders(); stopPrices(); stopMine(); stopTrades();
client.ws.disconnect();
```

These are the actual signatures: `connect()` takes no config, `subscribe()` returns a function, `unsubscribe()` takes the original options and optional handler, and state is a property with values `disconnected|connecting|connected|reconnecting` (`sdk/dist/index.d.ts:6212-6329`, `sdk/dist/index.d.ts:6000-6007`). The prose table/example claiming `connect(config?)`, subscription IDs, `unsubscribe(id)`, `getState()`, and a `disconnecting` state is stale (`docs-llms-full.txt:8110-8125`, `docs-llms-full.txt:8164-8215`).

Default reconnect behavior is enabled, 5 seconds between attempts, maximum 10, 30-second pings, and 10-second connection timeout (`sdk/dist/index.js:9986-9998`). Although `WebSocketModule` has a config constructor, `ThetanutsClient` constructs it without exposing that config, so these timings are not publicly configurable through `ThetanutsClientConfig` (`sdk/dist/index.js:16636-16646`). Only the URL is overrideable.

The client sends filter fields to the server (`sdk/dist/index.js:10435-10460`), but local dispatch invokes every handler whose key starts with the subscription type and does not re-check asset/address/filter (`sdk/dist/index.js:10473-10505`). Correctness therefore depends on server filtering; defensively re-filter in each handler. Because the protocol was not connected in this research, all WebSocket payload compatibility remains **UNVERIFIED**.

## 8. Base mainnet chain configuration (chainId 8453)

### Core contracts and feeds

| Kind | Name | Address |
|---|---|---|
| contract | OptionBook r12 | `0x1bDff855d6811728acaDC00989e79143a2bdfDed` |
| contract | OptionFactory r12 | `0x8118daD971dEbffB49B9280047659174128A8B94` |
| contract | HistoricalPriceConsumerV3_TWAP | `0xE909fb38767e0ac5F7a347DF9Dd4222217E10816` |
| feed | ETH | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` |
| feed | BTC | `0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F` |
| feed | SOL | `0x975043adBb80fc32276CbF9Bbcfd4A601a12462D` |
| feed | DOGE | `0x8422f3d3CAFf15Ca682939310d6A5e619AE08e57` |
| feed | XRP | `0x9f0C1dD78C4CBdF5b9cf923a549A201EdC676D34` |
| feed | BNB | `0x4b7836916781CAAfbb7Bd1E5FDd20ED544B453b1` |
| feed | PAXG | `0x5213eBB69743b85644dbB6E25cdF994aFBb8cF31` |
| feed | AVAX | `0xE70f2D34Fd04046aaEC26a198A35dD8F2dF5cd92` |

The core addresses are the literal r12 config at `sdk/dist/index.js:13-23`, `sdk/dist/index.js:66-77`, and `sdk/dist/index.js:168-178`. Deployment block is `45601440` (`sdk/dist/index.js:168-169`). The docs' early section labeling r10/current and giving OptionBook `0xd58b...` is stale (`docs-llms-full.txt:137-180`).

```ts
const baseConfig = client.chainConfig;
const optionBook = baseConfig.contracts.optionBook;
const optionFactory = baseConfig.contracts.optionFactory;
const twapConsumer = baseConfig.twapConsumer;
const feedToSymbol = buildPriceFeedSymbolMap(8453);
const implementation = getOptionImplementationInfo(8453, orderImplementation);
```

Those helpers are the intended case-insensitive config lookup surface (`sdk/dist/index.js:275-298`, `sdk/dist/index.d.ts:249-286`).

### Configured Base tokens

| Symbol | Address | Decimals | Classification from supplied context |
|---|---|---:|---|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 | primary collateral |
| WETH | `0x4200000000000000000000000000000000000006` | 18 | primary collateral |
| cbBTC | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | 8 | primary collateral |
| aBasWETH | `0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7` | 18 | Aave-wrapped / vault token |
| aBascbBTC | `0xBdb9300b7CDE636d9cD4AFF00f6F009fFBBc8EE6` | 8 | Aave-wrapped / vault token |
| aBasUSDC | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` | 6 | Aave-wrapped / vault token |
| cbDOGE | `0x73c7A9C372F31c1b1C7f8E5A7D12B8735c817C79` | 8 | additional token/underlying |
| cbXRP | `0x7B2Cd9EA5566c345C9cdbcF58f5E211a0dB47444` | 6 | additional token/underlying |

All eight are literally under `chainConfig.tokens` (`sdk/dist/index.js:24-64`). The bundled deprecated `collateralTokens` compatibility object contains only USDC/WETH/cbBTC (`sdk/dist/index.js:179-197`), and the embedded SDK context calls those three primary collateral while classifying the Aave and cbDOGE/cbXRP entries separately (`sdk-context-llms.js:797-801`). Therefore do not present all eight as currently liquid OptionBook collateral; derive actual collateral addresses from live orders as shown in section 2.

### Current r12 implementation slots

| Key / name | Address | Type | Strikes |
|---|---|---|---:|
| PUT | `0x7355EB92dfb0503DB558a70c10843618932ab290` | VANILLA | 1 |
| INVERSE_CALL | `0xE6c5756b0289e3f0994CB12eb8aB71Cd903Ed0Ea` | VANILLA | 1 |
| LINEAR_CALL | `0x051791df68223AE173Fade5217C48875e36eef61` | VANILLA | 1 |
| CALL_SPREAD | `0xfaeD63f7040E65b79cF0Ae29706fDc423eE249A9` | SPREAD | 2 |
| PUT_SPREAD | `0x02Fe0d9635e0139DBB3768a5d5Db404Fd84d9134` | SPREAD | 2 |
| INVERSE_CALL_SPREAD | `0x7Be48100b1B0349528A96D64953295Cd0Bbe4B70` | SPREAD | 2 |
| CALL_FLY | `0xa1d5f6b16A2e7f298F8d2cDF78F7779B4A20C4C2` | BUTTERFLY | 3 |
| PUT_FLY | `0x4fd2C6D271cC6FF3EbD2027da9815a0608d03AA3` | BUTTERFLY | 3 |
| CALL_CONDOR | `0x14476CF2ea9F7C448100F061670E390f17c78817` | CONDOR | 4 |
| PUT_CONDOR | `0xC742E422c7BB43A7FDe1CEF47997bC9D5b543cDD` | CONDOR | 4 |
| IRON_CONDOR | `0x9ebd7E23AfD52a48F557523019285EfEF2170D59` | IRON_CONDOR | 4 |
| RANGER | `0x9980ec85bc6fE07340adb36c76FA093bb6D4FcBc` | RANGER | 4 |
| CALL_LOAN | `0x7c444A2375275DaB925b32493B64a407eE955DEd` | LOAN_HANDLER | 1 |
| PHYSICAL_CALL | `0x8c56100caE246f7daa4BC1EC4d1477d71178c563` | VANILLA | 1 |
| PHYSICAL_PUT | `0x6aD53DD058bea004829cCf58a282C21a7Df02DcA` | VANILLA | 1 |
| PHYSICAL_CALL_SPREAD | `0x0000000000000000000000000000000000000000` | SPREAD | 2 (not deployed) |
| PHYSICAL_PUT_SPREAD | `0x0000000000000000000000000000000000000000` | SPREAD | 2 (not deployed) |
| PHYSICAL_CALL_FLY | `0x0000000000000000000000000000000000000000` | BUTTERFLY | 3 (not deployed) |
| PHYSICAL_PUT_FLY | `0x0000000000000000000000000000000000000000` | BUTTERFLY | 3 (not deployed) |
| PHYSICAL_CALL_CONDOR | `0x0000000000000000000000000000000000000000` | CONDOR | 4 (not deployed) |
| PHYSICAL_PUT_CONDOR | `0x0000000000000000000000000000000000000000` | CONDOR | 4 (not deployed) |
| PHYSICAL_IRON_CONDOR | `0x0000000000000000000000000000000000000000` | IRON_CONDOR | 4 (not deployed) |

The slot addresses are literal at `sdk/dist/index.js:79-105`; current reverse metadata, including name/type/strike count, is at `sdk/dist/index.js:151-166`. The zero physical-multileg slots do not have reverse-registry entries; their family/count above follows their declared keys and the public implementation interface (`sdk/dist/index.d.ts:189-244`). OptionBook is cash-settled only, so physical and loan entries must not be offered as Book structures (`sdk-context-llms.js:726-728`).

### Historical implementation reverse lookups

These addresses are retained for decoding indexed historical options/orders; they are not current creation slots.

| Deployment | Address | Name | Type | Strikes |
|---|---|---|---|---:|
| 8453_v6 | `0x3ceb524cba83d2d4579f5a9f8c0d1f5701dd16fe` | INVERSE_CALL | VANILLA | 1 |
| 8453_v6 | `0xf480f636301d50ed570d026254dc5728b746a90f` | PUT | VANILLA | 1 |
| 8453_v6 | `0x4d75654bc616f64f6010d512c3b277891fb52540` | CALL_SPREAD | SPREAD | 2 |
| 8453_v6 | `0xed0fae13331ab620504918469fa47cf6a499a55e` | INVERSE_CALL_SPREAD | SPREAD | 2 |
| 8453_v6 | `0xc9767f9a2f1eadc7fdcb7f0057e829d9d760e086` | PUT_SPREAD | SPREAD | 2 |
| 8453_v6 | `0xd8ea785ab2a63a8a94c38f42932a54a3e45501c3` | CALL_FLY | BUTTERFLY | 3 |
| 8453_v6 | `0x1fe24872ab7c83bba26dc761ce2ea735c9b96175` | PUT_FLY | BUTTERFLY | 3 |
| 8453_v6 | `0x494cd61b866d076c45564e236d6cb9e011a72978` | IRON_CONDOR | IRON_CONDOR | 4 |
| 8453_v6 | `0xbb5d2eb2d354d930899dabad01e032c76cc3c28f` | CALL_CONDOR | CONDOR | 4 |
| 8453_v6 | `0xbdacc00dc3f6e1928d9380c17684344e947aa3ec` | PUT_CONDOR | CONDOR | 4 |
| 8453_v6 | `0x07032ffb1df85ec006be7c76249b9e6f39b60f32` | PHYSICAL_CALL | VANILLA | 1 |
| 8453_v6 | `0xac5eca7129909de8c12e1a41102414b5a5f340aa` | PHYSICAL_PUT | VANILLA | 1 |
| 8453_v6 | `0x6e0019bf9a44b60d57435a032cb86b716629c08e` | CALL_LOAN | LOAN_HANDLER | 1 |
| v6 deprecated | `0x72fc2920137e42473935d511b4ad29efa34164c8` | PHYSICAL_CALL | VANILLA | 1 |
| v6 deprecated | `0x9da79023af00d1f2054bb1eed0d49004fe41c5b5` | PHYSICAL_PUT | VANILLA | 1 |
| v6 deprecated | `0xf1e551ab55b1303dea76ed8d92b76f99eeec75d6` | PHYSICAL_CALL | VANILLA | 1 |
| v6 deprecated | `0xc305f561ef1de00f06b227f7593763c65c479f1b` | PHYSICAL_PUT | VANILLA | 1 |
| Base_r10 | `0x1fdec69e5ac4fa9cb7092f381c2dd5688759d43c` | INVERSE_CALL | VANILLA | 1 |
| Base_r10 | `0x64b4b21bf0845c79661f60ed48aa24d54bf74bb5` | PUT | VANILLA | 1 |
| Base_r10 | `0x2db5afa04aee616157beb53b96612947b3d13ee3` | CALL_SPREAD | SPREAD | 2 |
| Base_r10 | `0xb529ba9d8d877d2641c8e8efed91ff603f09646e` | INVERSE_CALL_SPREAD | SPREAD | 2 |
| Base_r10 | `0x571471b2f823cc6b5683fc99ac6781209bc85f55` | PUT_SPREAD | SPREAD | 2 |
| Base_r10 | `0xeeeb29c9454974c89c5fb1b3190fcb46b74f1ea1` | LINEAR_CALL | VANILLA | 1 |
| Base_r10 | `0xb727690fdd4bb0ff74f2f0cc3e68297850a634c5` | CALL_FLY | BUTTERFLY | 3 |
| Base_r10 | `0x78b02119007f9efc2297a9738b9a47a3bc3c2777` | PUT_FLY | BUTTERFLY | 3 |
| Base_r10 | `0x7d3c622852d71b932d0903f973caff45bcdba4f1` | CALL_CONDOR | CONDOR | 4 |
| Base_r10 | `0x5cc960b56049b6f850730facb4f3eb45417c7679` | PUT_CONDOR | CONDOR | 4 |
| Base_r10 | `0xb200253b68fbf18f31d813aecef97be3a6246b79` | IRON_CONDOR | IRON_CONDOR | 4 |
| Base_r10 | `0x025a8ef95f8939ffdba6a45973a28695846e9e45` | PHYSICAL_CALL | VANILLA | 1 |
| Base_r10 | `0x2d283d7ade2896d98331496ee761f15ed1d6a699` | PHYSICAL_PUT | VANILLA | 1 |
| Base_r10 | `0x6a1d5ce9e3bdef110a06d8d025c171189d926d72` | RANGER | RANGER | 2 |

This table is the literal historical reverse registry at `sdk/dist/index.js:107-150`. Notice r10 Ranger has two strikes whereas r12 Ranger has four; never infer Ranger shape from the name alone across deployments.

### Other Base-specific exported configs (not OptionBook chain config)

For completeness, the package separately hardcodes LoanCoordinator `0x9FB75b24d9d6f7c29D6BdE2870697A4FE0395994` and LoanHandler `0x7c444A2375275DaB925b32493B64a407eE955DEd` (`sdk/dist/index.js:12848-12868`). Collar's three contract slots are all zero/un-deployed (`sdk/dist/index.js:13916-13948`). StrategyVault has five fixed-strike vaults, three CLVEX vaults, Aave Pool/DataProvider/Oracle, and an older separate OptionFactory at the literal addresses in `sdk/dist/index.js:15961-15998`; Multicall3 is `0xcA11bde05977b3631167028862bE2a173976CA11` (`sdk/dist/index.js:16001-16004`). These are outside Thesis.fun's OptionBook path and should not be confused with the canonical r12 factory/book.

## 9. Decimal and unit reference

The safest rule is: retain API/chain integers as bigint, attach decimals/provenance to every stored amount, and read collateral decimals from the actual token address. Generic exact conversion helpers are `toBigInt`, `fromBigInt`, `scaleDecimals`, `formatAmount`, and `parseAmount` (`sdk/dist/index.d.ts:14603-14661`).

| Value | Unit | Scale in the supplied inputs | Safe handling |
|---|---|---|---|
| `strikes[]` | USD price | 8 decimals | `toStrikeDecimals` / `fromStrikeDecimals`; never JS division in persisted math |
| settlement/TWAP price | USD price | 8 decimals | `getTWAP`; `toPriceDecimals` / `fromPriceDecimals` |
| OptionBook signed `price` | collateral token per contract | 8 decimals | `pricePerContract`; formula uses denominator `1e8` |
| caller fill `usdcAmount` | taker spend/premium budget | collateral-token base units; docs/runtime assume USDC 6 | use actual collateral token decimals; non-USDC behavior **UNVERIFIED** |
| `maxCollateralUsable` / `availableAmount` | maker collateral budget | collateral-token native decimals | resolve address through `chainConfig.tokens`, or call ERC-20 `decimals()` |
| preview `totalCollateral` | actually local total premium/spend | same units as fill amount | recompute after cap: `numContracts * price / 1e8` |
| OptionBook order/fill `numContracts` | contracts | declaration says 6 decimals for USDC; docs also say collateral decimals | preserve the returned/on-chain bigint; do not assume 18 |
| generic/RFQ utility `numContracts` | contracts | defaults to 18 decimals | pass explicit `sizeDecimals` when using `calculatePayout`/`calculateCollateral` |
| locked `collateralAmount` | collateral token | token native decimals | read token decimals and option's value directly |
| premium, fee, payout, returned collateral | collateral token | token native decimals | format with `Position.collateralDecimals` or token metadata |
| `pnlUsd` | USD | 8 decimals per declaration | it is a decimal string/null; do not `Number()` for accounting |
| `MarketDataResponse.prices` | human USD | JS number | display/indicative only |
| `MarketPrice.price` | USD, exact scale undocumented | bigint, **UNVERIFIED scale** | capture a live row before use |
| MM bid/ask/mark | units of underlying per contract | JS number | indicative pricing only; conversion to token base units is module-specific |
| expiry/order expiry/timestamps | Unix seconds | integer number/bigint | do not confuse with millisecond market-data metadata |
| referral split | basis points | integer bigint, 10,000 = 100% | format separately from token units |
| native fee for `split`/`reclaimCollateral` | wei | 18-decimal native ETH | SDK signer wrappers read and forward exact `msg.value` |

The source declaration fixes strikes and signed price at 8 decimals and describes OptionBook contracts as 6 decimals for USDC (`sdk/dist/index.d.ts:731-762`); the docs' decimal table says contract size follows collateral decimals (`docs-llms-full.txt:10044-10058`). In conflict, exported `DECIMALS` has `OPTION_SIZE: 18`, while `client.utils.decimals` has a different key `SIZE: 18` (`sdk/dist/index.js:10582-10591`, `sdk/dist/index.js:10679-10693`). The docs even show both mutually inconsistent rules on adjacent lines and refer to nonexistent exported `DECIMALS.SIZE` (`docs-llms-full.txt:10050-10070`). This is not editorial trivia: never convert an OptionBook fill size with an assumed `18` until the live contract/API confirms it.

Correct conversions:

```ts
const token = Object.values(client.chainConfig.tokens).find(
  (t) => t.address.toLowerCase() === collateralAddress.toLowerCase(),
);
const collateralDecimals = token?.decimals ??
  await client.erc20.getDecimals(collateralAddress);

const budget = client.utils.toBigInt(userInputString, collateralDecimals);
const strike = client.utils.toStrikeDecimals(strikeInputString); // 8 dp
const displayBudget = client.utils.fromBigInt(budget, collateralDecimals);

// Do not rescale this. It is the contract-size integer accepted by this order.
const exactContracts = preview.numContracts;
```

The strike/price/USDC convenience methods are declared at `sdk/dist/index.d.ts:6743-6853`. Prefer string input to `toBigInt`; it truncates extra fractional digits rather than rounding up (`sdk/dist/index.d.ts:14614-14634`). `strikeFromChain()` returns JS number and is suitable for UI only (`sdk/dist/index.d.ts:6762-6775`).

For pure payout math, always supply all three scales:

```ts
const payout = client.utils.calculatePayout({
  type: payoutType,
  strikes: exactStrikes8dp,
  settlementPrice: exactSettlement8dp,
  numContracts: exactContracts,
  priceDecimals: 8,
  sizeDecimals: verifiedContractSizeDecimals,
  collateralDecimals,
});
```

The utility defaults are price 8, size 18, collateral 6 (`sdk/dist/index.d.ts:6502-6535`), and its formula scales with those parameters (`sdk/dist/index.js:10834-10839`, `sdk/dist/index.js:10998-10999`). `calculatePremium` likewise defaults to 8/18/6 (`sdk/dist/index.js:11143-11155`), so its default is unsafe for a USDC OptionBook row documented as 6-decimal size.

## 10. Gotchas and implementation hazards

### The supplied SDK-context gotchas, all accounted for

1. `availableAmount` is maker collateral, not contracts; preview it (`sdk-context-llms.js:698-700`).
2. RFQ `collateralAmount` must be zero because collateral is pulled at RFQ settlement; this does not apply to filling an existing OptionBook order (`sdk-context-llms.js:702-704`).
3. BaseOption/Ranger `split` and `reclaimCollateral` are payable in r12; the SDK forwards on-chain fee values as native `msg.value` (`sdk-context-llms.js:706-708`).
4. `getReclaimFee`/`reclaimCollateral` takes the owned-option address, not caller address (`sdk-context-llms.js:710-712`).
5. Seven physical multi-leg implementations are undeployed zero placeholders (`sdk-context-llms.js:714-716`).
6. Butterfly lookup names are `CALL_FLY`/`PUT_FLY`, not old `*_FLYS` (`sdk-context-llms.js:718-720`).
7. Strategy-vault symbols changed to `fixedStrike`/`getFixedStrikeVaults` with no aliases (`sdk-context-llms.js:722-724`).
8. OptionBook is cash-settled only (`sdk-context-llms.js:726-728`).
9. Public Base RPCs throttle bursts and may emit data-less `CALL_EXCEPTION`; use a production RPC (`sdk-context-llms.js:730-736`).
10. Since v0.2.2, missing signer remains typed `SIGNER_REQUIRED`; do not catch it as generic `CONTRACT_REVERT` (`sdk-context-llms.js:738-740`).
11. r12 `getValidNumContracts` returns `{validContracts,collateralRequired}`, not one bigint (`sdk-context-llms.js:742-744`).
12. Do not recompute/float-round contract counts for closes or splits; reuse the on-chain bigint (`sdk-context-llms.js:746-748`).
13. The pricing module is `client.mmPricing`, not `client.pricing` (`sdk-context-llms.js:750-752`).
14. WheelVault is Ethereum-only; a Base client rejects it (`sdk-context-llms.js:754-760`).
15. Ranger and StrategyVault are Base-only, while v0.2+ has no selector for the predecessor Base deployment (`sdk-context-llms.js:762-768`). The context also warns that 0.x releases have included patch-level breaking changes, so pin exactly (`sdk-context-llms.js:772-783`).

### Additional findings from declarations/runtime

- **Browser constructor failure:** explicit `keyStorageProvider` is required even for an OptionBook-only client because RFQKeyManager is eager (section 1; `sdk/dist/index.js:11712-11729`).
- **Preview naming/cap bug:** `totalCollateral` is premium/spend, and remains the user's unbounded input after size capping (`sdk/dist/index.js:1717-1735`).
- **“Exact preview” is overstated:** preview is local arithmetic; it does not query nonce/cancellation/minimums, and the chain simulation requires a signer (`sdk/dist/index.js:2407-2463`).
- **3/4-leg max-size approximation:** max/min outer range is used instead of implementation-specific wing payout (`sdk/dist/index.js:1680-1691`).
- **Server-filter drift:** declarations use `type`, docs use `isCall`, and filtered results lack `rawApiData` needed to fill (`sdk/dist/index.d.ts:1216-1227`, `sdk/dist/index.js:2639-2650`).
- **Asset normalizer is BTC/ETH-only:** `underlyingToken` becomes zero for the other configured feeds (`sdk/dist/index.js:2520-2530`).
- **No min-fill wrapper:** `minNumContracts`, `minPremiumAmount`, maker cutoffs, and tuple validation are in the exported ABI, but not exposed as `OptionBookModule` methods (`sdk/dist/index.js:1287-1325`, `sdk/dist/index.d.ts:1915-2274`). Use viem reads before send.
- **Encoded writes omit safety checks:** external encode does not call `assertNetwork` and does not check expiry; the app must do both (`sdk/dist/index.js:1764-1804`, `sdk/dist/index.js:1860-1889`).
- **Historical-book rejection:** an API order carrying a noncanonical book address is rejected even if its implementation is historically known (`sdk/dist/index.js:1562-1582`).
- **No slippage parameter:** the OptionBook fill signs a fixed order price and the public `slippageBps` client property is deprecated/no-op; re-fetch and show the exact signed price (`sdk/dist/index.d.ts:9552-9558`).
- **WebSocket filters rely on server:** local dispatch ignores asset/address/filter and fans out by type prefix (`sdk/dist/index.js:10473-10505`).
- **MM pricing is not universal:** ETH/BTC only, float-based, with fractional `getPositionPricing.numContracts` rejected by `BigInt(number)` (`sdk/dist/index.js:12078-12127`, `sdk/dist/index.js:12400-12410`).
- **Ticker precision loss:** `buildTicker` integer-divides bigint strikes by `1e8`, losing fractional-dollar strike digits (`sdk/dist/index.js:12129-12136`).
- **Indexer omission becomes zero:** current value/P&L absence normalizes to `0n`, obscuring “unknown” (`sdk/dist/index.js:3433-3440`).
- **`OrderFilled` event helper is stale:** the canonical r12 event emits buyer/seller, option address, premium, fees, referrer, and maker-side flag, while `OrderFillEvent` and EventsModule expect maker/taker/option/size/price. Parse receipts or historical logs with `OPTION_BOOK_ABI` directly (`sdk/dist/index.js:1453-1467`, `sdk/dist/index.d.ts:5385-5407`, `sdk/dist/index.js:9150-9175`).
- **Fee scan is over-broad:** all eight configured tokens are queried, not only observed OptionBook collateral (`sdk/dist/index.js:1932-1969`).
- **Docs are internally stale:** old r10 addresses, user-callable payout, incorrect CallStatic shape, incorrect order fields, and incorrect WebSocket APIs all conflict with v0.3.0 declarations/runtime (citations in sections 2, 3, 5, 7, and 8).
- **Custom-error mapping is shallow:** HTTP maps only 400/404/429 specially; contract errors are categorized through lowercase message substring checks for allowance, balance, expiry, and slippage, then collapse to `CONTRACT_REVERT` (`sdk/dist/index.js:483-545`). Preserve `error.cause` and raw RPC revert data in telemetry.
- **Order data is signed:** do not mutate any raw field except the fill `numContracts`; the signature binds the rest (`sdk/dist/index.js:1584-1615`).
- **Freshness races remain:** poll roughly every 30 seconds but always fetch again immediately before execution (`docs-llms-full.txt:202-220`).

Recommended error handling:

```ts
import { isThetanutsError } from "@thetanuts-finance/thetanuts-client";

try {
  // external wallet send + receipt wait
} catch (cause) {
  if (isThetanutsError(cause)) {
    switch (cause.code) {
      case "ORDER_EXPIRED":
      case "INVALID_ORDER":
      case "SIZE_EXCEEDED":
        await refetchOrders();
        break;
      case "INSUFFICIENT_ALLOWANCE":
        await requestApproval();
        break;
      case "NETWORK_UNSUPPORTED":
        await requestBaseSwitch();
        break;
      case "RATE_LIMIT":
        scheduleBackoff();
        break;
      default:
        log({ code: cause.code, message: cause.message, cause: cause.cause });
    }
  } else {
    logViemError(cause); // decode OPTION_BOOK_ABI custom errors where possible
  }
}
```

The full SDK error-code union is at `sdk/dist/index.d.ts:346-349`; concrete error classes and narrowing pattern are at `sdk/dist/index.d.ts:351-447`.

## 11. Browser versus Node runtime behavior

The inspected CJS bundle has only two eager top-level requires: `axios` and `ethers` (`sdk/dist/index.js:1-8`). It contains no `process.env` use, no `better-sqlite3`, and no eager filesystem access. The package requires Node >=18 for its package contract and makes ethers a required peer dependency (`sdk/package.json:59-86`). The package's `import` condition points to `dist/index.mjs`, which was not one of the user-pinned input files; browser bundling behavior of that ESM artifact is therefore **UNVERIFIED** (`sdk/package.json:8-17`).

Node filesystem/crypto access is confined to the internal default RFQ key file provider and is dynamically imported (`sdk/dist/index.js:11613-11669`). The default-storage selector chooses this provider outside a browser (`sdk/dist/index.js:11714-11721`). `FileStorageProvider` is not exported in the public declarations; only these storage abstractions are public:

- `KeyStorageProvider`: sync/async `get`, `set`, `remove`, `has` interface (`sdk/dist/index.d.ts:45-71`);
- `MemoryStorageProvider`: exported, ephemeral (`sdk/dist/index.d.ts:73-85`);
- `LocalStorageProvider`: exported browser storage, plaintext and not recommended (`sdk/dist/index.d.ts:87-106`).

RFQ encryption also uses global Web Crypto (`crypto.getRandomValues` / `crypto.subtle`) (`sdk/dist/index.js:12012-12043`). WebSocket uses the global browser `WebSocket` constructor and explicitly throws when it is unavailable, so Node requires an externally installed/polyfilled global even though package metadata overrides a `ws` version (`sdk/dist/index.js:10050-10063`, `sdk/package.json:67-69`). Axios HTTP and ethers RPC operations are otherwise environment-neutral in the inspected bundle.

An OptionBook-only browser client should therefore be:

```ts
const optionBookOnly = new ThetanutsClient({
  chainId: 8453,
  provider: ethersReadProvider,
  keyStorageProvider: new MemoryStorageProvider(), // RFQ module unused
});

// Used: api, optionBook preview/encode, erc20 reads/encode, option reads,
// utils, optionally ws/mmPricing.
// Unused: rfqKeys, optionFactory, loan, collar, wheelVault, strategyVault.
```

OptionBook itself needs no encryption keys, file storage, Node crypto, or RFQ State API. It needs the orders HTTP API, Book indexer for discovery, ethers provider for reads, and either an ethers signer or raw encoded transactions sent through viem (`sdk/dist/index.d.ts:9391-9503`).

## 12. What Thesis.fun should and should not use

### Use now

```ts
await client.api.fetchOrders();
client.optionBook.previewFillOrder(order, budget, referrer);
client.erc20.encodeApprove(collateral, client.optionBook.contractAddress, amount);
client.optionBook.encodeFillOrder(order, amount, referrer);
await client.api.getUserPositionsFromIndexer(address);
await client.option.getFullOptionInfo(optionAddress);
await client.option.getTWAP(optionAddress);
await client.option.calculatePayout(optionAddress, settlementPrice);
```

Those methods cover live order discovery, external-wallet writes, indexed discovery, and known-position on-chain verification (`sdk/dist/index.d.ts:2311-2371`, `sdk/dist/index.d.ts:1991-2057`, `sdk/dist/index.d.ts:5043-5208`). Also store the raw order, implementation/feed/collateral addresses, exact bigints, fill hash, log-derived option address, referrer, and chain ID in the app database; the hosted indexer is explicitly a derived service rather than chain truth (`docs-llms-full.txt:474-476`).

### Do not use, or gate behind verification

- **Do not use `client.option.payout()`**: it always throws on r12; settlement is automatic (`sdk/dist/index.js:7675-7703`).
- **Do not use RFQ/MCP/agent flows for thesis creation or execution.** RFQ is a sealed-bid custom-option system with key management and a ~60-second auction, while OptionBook is the instant listed path (`docs-llms-full.txt:2443-2455`). This product's creator manually chooses current OptionBook liquidity.
- **Do not use physical implementations in OptionBook.** Book is cash-settled; seven physical-multileg addresses are zero (`sdk-context-llms.js:714-728`).
- **Do not use `filterOrders()` for fillable rows** until its normalizer/API contract is fixed (`sdk/dist/index.js:2639-2650`, `sdk/dist/index.js:3325-3332`).
- **Do not use `swapAndFillOrder` in v1.** It always requests a max fill and the allowance/call-data trust surface needs live verification (`sdk/dist/index.js:2133-2167`).
- **Do not treat `preview.totalCollateral` as max loss or exact collateral.** It is locally assigned premium and has a cap inconsistency (`sdk/dist/index.js:1717-1735`).
- **Do not use `client.utils.calculateMaxPayout` without implementation flags and verified size decimals.** Its reduced order input lacks a native four-strike discriminator, so iron-condor/ranger require explicit flags (`sdk/dist/index.d.ts:6854-6894`, `sdk/dist/index.d.ts:6993-7002`). Prefer `calculatePayout({type,...})` with an implementation-derived `PayoutType` and explicit scales.
- **Do not depend on MM pricing for all markets or call it authoritative live P&L.** It supports ETH/BTC only and represents off-chain market-maker adjustments (`sdk/dist/index.d.ts:7160-7163`, `sdk/dist/index.d.ts:7518-7529`).
- **Do not make WebSocket correctness critical initially.** The docs/API drift and filter fan-out demand a polling/indexer fallback (`docs-llms-full.txt:8110-8125`, `sdk/dist/index.js:10473-10505`).
- **Do not use `client.events.getOrderFillEvents()` for position discovery.** Its schema predates the current r12 `OrderFilled` ABI; use viem log parsing with exported `OPTION_BOOK_ABI` (`sdk/dist/index.js:1453-1467`, `sdk/dist/index.js:9150-9175`).
- **Do not use Collar writes.** Contract slots are zero; its own config gates them (`sdk/dist/index.js:13916-13948`).
- **Do not use WheelVault on Base.** It is Ethereum-only (`sdk-context-llms.js:754-760`).
- **Do not route through the separate strategy-vault/loan modules** for OptionBook positions; they have distinct contracts, indexers, and product semantics (`sdk/dist/index.js:12848-12880`, `sdk/dist/index.js:15961-15998`).
- **Do not trust old r10 examples/addresses.** v0.3.0 chain config is r12, deployed from block 45601440 (`sdk/dist/index.js:151-178`).

The docs' indexer migration page records unresolved data gaps: referrer `userDailyMetrics` and `topProfitableTrades` were not implemented, and factory RFQ pagination was ignored (`docs-llms-full.txt:10700-10735`). Those do not block the core Book fill, but they reinforce storing app-owned social/trade records and verifying material position facts on-chain.

## Open questions the team must verify live

1. **Contract-size scale by collateral/product.** Resolve the conflict between OptionBook's 6-decimal-USDC struct comment, docs saying collateral decimals, and generic `SIZE = 18`. For one live order of every implementation/collateral, compare preview size, `getValidNumContracts`, fill calldata/log, and deployed option `numContracts()` (`sdk/dist/index.d.ts:752-759`, `docs-llms-full.txt:10050-10070`).
2. **Fill debit for both maker directions.** Confirm which token amount the taker approves/pays when `raw.isLong` is true versus false, and whether `preview.totalCollateral` is premium, seller collateral, or conditionally one of them. Runtime unconditionally calculates from price, so short-side behavior is especially important (`sdk/dist/index.js:1713-1739`).
3. **Capped-budget bug.** Supply a budget above remaining capacity on a fork/small live test and verify the exact debit; determine whether recomputed premium is always sufficient and whether rounding requires +1 base unit (`sdk/dist/index.js:1724-1735`).
4. **3/4-leg sizing.** Compare local outer-width `calculateMaxContracts` to r12 `getValidNumContracts` for butterflies, condors, iron condors, and Ranger (`sdk/dist/index.js:1680-1691`, `sdk/dist/index.js:1287-1307`).
5. **Minimums and cancellation state.** Read `minNumContracts`, `minPremiumAmount`, maker cutoff, nonce/cancellation state, and tuple validation immediately before external-wallet send; define the UI error paths because `encodeFillOrder` omits these checks (`sdk/dist/index.js:1287-1325`, `sdk/dist/index.js:1860-1889`).
6. **Settlement keeper and timing.** Identify the r12 callback caller, post-expiry delay, TWAP period per implementation, oracle staleness/failure path, retry semantics, and exact events. The inputs only establish automatic factory callback and an older “processed daily” statement (`sdk/dist/index.js:7675-7703`, `docs-llms-full.txt:113-123`).
7. **Settlement accounting.** Confirm whether indexer `entryPremium`/`entryPrice` is total or per-contract, gross or net; which side pays `entryFeePaid`; and the exact buyer/seller P&L equations (`sdk/dist/index.js:3416-3466`).
8. **Bilateral close mechanics.** Determine who calls `close()`, what prior approval/agreement is required, what collateral/premium moves, and whether a tradable unwind route exists. The SDK call has no price or counterparty parameter (`sdk/dist/index.js:7508-7538`).
9. **All-market marks.** Obtain a supported pricing source/ticker convention for SOL, DOGE, XRP, BNB, PAXG, AVAX and any new live feeds. `mmPricing` only accepts ETH/BTC (`sdk/dist/index.js:12078-12127`).
10. **Order API and feed coverage.** Capture live `GET /` rows to confirm all optional fields, Greeks nullability, raw numeric/string forms, current canonical `optionBookAddress`, and whether every configured feed symbol is used (`sdk/dist/index.js:3346-3403`).
11. **`/prices` scale.** Capture a live response and determine the decimal scale represented by `MarketPrice.price: bigint` (`sdk/dist/index.d.ts:1425-1439`, `sdk/dist/index.js:2780-2787`).
12. **WebSocket compatibility.** Verify server subscription envelopes, each update payload, server-side filters, reconnect/resubscribe behavior, and whether unsupported filters are rejected (`sdk/dist/index.js:10420-10520`).
13. **External-wallet revert decoding.** Test viem simulation against the exported ABI and map canonical r12 custom errors to product messages; SDK mapping otherwise collapses most custom errors (`sdk/dist/index.js:519-545`).
14. **ERC-20 approval quirks.** Check exact-approval and approve-zero requirements for every collateral address that appears in live orders; the generic encoder merely emits standard `approve(spender,amount)` (`sdk/dist/index.d.ts:639-666`).
15. **Indexer latency/reorg behavior.** Measure delay from receipt to `/user/{address}/positions`, finality policy, duplicate/reorg handling, and whether `triggerIndexerUpdate()` is still appropriate on the new indexer. The legacy guide's manual sync timings and host are stale (`docs-llms-full.txt:484-498`).
16. **Browser distribution.** Build the actual ESM import in the target Next.js client boundary, confirm no Node polyfills are emitted, and confirm `MemoryStorageProvider` avoids all dynamic `fs` paths. Package export metadata points browsers/importers to an unpinned `index.mjs` not analyzed here (`sdk/package.json:8-17`).
17. **Small-mainnet end-to-end matrix.** Before launch, fill one tiny long and one tiny short for every live collateral and structure, then reconcile wallet debits, OptionBook logs, option proxy fields, indexer row, expiry settlement, and fee ledger. The docs expressly require production review/testing and warn orders can race between fetch and execution (`docs-llms-full.txt:107-123`, `docs-llms-full.txt:202-206`).
