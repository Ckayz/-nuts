import { test } from "bun:test";
import { loadProductionFill } from "../src/lib/trade/production-fills";
import { measureDebit } from "../src/lib/trade/chain";
test("probe", async () => {
  const hash = "0x3e7417c5c676109e737f540debe95d0aec9477c9797c19f37e626d0c611cff04" as const;
  const f = await loadProductionFill(hash);
  const debit = measureDebit({ logs: f.logs, token: f.order.rawApiData!.collateral, wallet: f.taker });
  console.log(JSON.stringify({
    takerSide: f.takerSide, taker: f.taker,
    collateral: f.order.rawApiData!.collateral,
    numContracts: f.order.order.numContracts.toString(),
    price: f.order.order.price.toString(),
    strikes: f.order.rawApiData!.strikes,
    isLong: f.order.rawApiData!.isLong, isCall: f.order.rawApiData!.isCall,
    implementation: f.order.rawApiData!.implementation,
    premium: f.event.premiumAmount.toString(), fee: f.event.feeCollected.toString(),
    nonce: f.event.nonce.toString(), maker: f.order.makerAddress,
    buyer: f.event.buyer, seller: f.event.seller, sellerWasMaker: f.event.sellerWasMaker,
    debit: debit.toString(), extraOptionData: f.order.rawApiData!.extraOptionData,
  }, null, 2));
}, 60000);
