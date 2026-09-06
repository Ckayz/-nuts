/**
 * RFQ calldata tests. Offline: the client constructor does not touch the
 * network (measured — an unreachable RPC URL still builds and encodes), and
 * every encoder used here is pure.
 *
 * The load-bearing assertions all read the CALLDATA, not the arguments that
 * produced it: `decodeFunctionData` against the SDK's own `OPTION_FACTORY_ABI`
 * is the second, independent means for every number this module reports.
 */
import { describe, expect, test } from "bun:test";
import { OPTION_FACTORY_ABI, type ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { decodeFunctionData, encodeEventTopics, type Abi, type Hex } from "viem";
import {
  buildRfqCancel,
  buildRfqCreate,
  buildRfqSettle,
  createReadClient,
  decimalToBaseUnits,
  decodeQuotationRequested,
  QUOTATION_REQUESTED_TOPIC,
  ThetanutsLogicError,
  type RfqClient,
  type RfqCreateParams,
} from "../src";

const client = createReadClient({ rpcUrl: "http://127.0.0.1:1" });
const factoryAbi = OPTION_FACTORY_ABI as unknown as Abi;

/** A real client satisfies the structural client this module asks for. */
const typeCheck: RfqClient = client satisfies ThetanutsClient;
void typeCheck;

const FACTORY = client.chainConfig.contracts.optionFactory as string;
const USDC = client.chainConfig.tokens.USDC?.address as string;
const OPTION_BOOK = client.chainConfig.contracts.optionBook as string;
const REQUESTER = "0x1111111111111111111111111111111111111111" as const;
const PUBLIC_KEY = `0x02${"11".repeat(32)}`;

const nowSeconds = () => Math.floor(Date.now() / 1_000);

function params(overrides: Partial<RfqCreateParams> = {}): RfqCreateParams {
  return {
    requester: REQUESTER,
    underlying: "ETH",
    strikesUsd: ["2300"],
    expiry: nowSeconds() + 7 * 86_400,
    numContracts: "1.5",
    reservePricePerContract: "0.5",
    offerDeadlineMinutes: 60,
    requesterPublicKey: PUBLIC_KEY,
    ...overrides,
  };
}

/** Reads the create calldata back with the factory ABI — the test's own decode, not the module's. */
function decodeCreate(data: Hex) {
  const decoded = decodeFunctionData({ abi: factoryAbi, data });
  const args = decoded.args as readonly unknown[];
  return {
    functionName: decoded.functionName,
    params: args[0] as Record<string, unknown>,
    tracking: args[1] as Record<string, unknown>,
    reservePrice: args[2] as bigint,
    publicKey: args[3] as string,
  };
}

function decodeApprove(data: Hex) {
  const body = data.slice(2).toLowerCase();
  return {
    selector: `0x${body.slice(0, 8)}`,
    spender: `0x${body.slice(8 + 24, 8 + 64)}`,
    amount: BigInt(`0x${body.slice(8 + 64)}`),
  };
}

describe("rfq create calldata", () => {
  test("a vanilla BUY put encodes every field, and the deposit is the escrowed reserve, not requesterDeposit", () => {
    const built = buildRfqCreate({ client, params: params(), allowance: 0n });

    // Read straight out of the bytes that would be sent.
    const decoded = decodeCreate(built.create.data);
    expect(decoded.functionName).toBe("requestForQuotation");
    expect(built.create.to.toLowerCase()).toBe(FACTORY.toLowerCase());
    expect(built.create.value).toBe(0n);
    expect(built.factory.toLowerCase()).toBe(FACTORY.toLowerCase());

    // MEASURED: the escrow lives in the top-level reservePrice; requesterDeposit is always 0.
    expect(decoded.params.requesterDeposit).toBe(0n);
    expect(decoded.params.collateralAmount).toBe(0n);
    expect(decoded.reservePrice).toBe(750_000n); // 0.5 USDC × 1.5 contracts
    expect(built.expected.depositBaseUnits).toBe(decoded.reservePrice);
    expect(built.expected.requesterDepositField).toBe(0n);

    // deposit === reservePerContract × numContracts / contractUnit, from the DECODED values.
    expect(built.expected.depositBaseUnits).toBe(
      (built.expected.reservePriceBaseUnits * built.expected.numContracts) / 1_000_000n,
    );
    expect(built.expected.reservePriceBaseUnits).toBe(500_000n);

    // Contract size unit: USDC decimals, so one contract is 1_000_000.
    expect(decoded.params.numContracts).toBe(1_500_000n);
    expect(built.expected.numContracts).toBe(1_500_000n);

    expect(decoded.params.strikes).toEqual([230_000_000_000n]); // 8 decimals
    expect(built.expected.strikesUsd8).toEqual([230_000_000_000n]);
    expect(decoded.params.isRequestingLongPosition).toBe(true);
    expect(decoded.params.convertToLimitOrder).toBe(false);
    expect(built.expected.convertToLimitOrder).toBe(false);
    expect((decoded.params.collateral as string).toLowerCase()).toBe(USDC.toLowerCase());
    expect(built.expected.collateral).toEqual({ address: USDC as `0x${string}`, symbol: "USDC", decimals: 6 });
    expect((decoded.params.implementation as string).toLowerCase()).toBe(
      (client.chainConfig.implementations.PUT as string).toLowerCase(),
    );
    expect(decoded.publicKey).toBe(PUBLIC_KEY);
    expect(decoded.tracking.referralId).toBe(0n);
    expect(built.expected.referralId).toBe(0n);

    // The offer deadline the SDK stamps from its own clock, and the expiry we asked for.
    const offerEnd = Number(built.expected.offerEndTimestamp);
    expect(offerEnd - nowSeconds()).toBeGreaterThanOrEqual(3_595);
    expect(offerEnd - nowSeconds()).toBeLessThanOrEqual(3_605);
    expect(built.expected.expiryTimestamp).toBeGreaterThan(built.expected.offerEndTimestamp);
  });

  test("a referral id travels into the tracking tuple", () => {
    const built = buildRfqCreate({ client, params: params({ referralId: 42n }), allowance: 0n });
    expect(decodeCreate(built.create.data).tracking.referralId).toBe(42n);
    expect(built.expected.referralId).toBe(42n);
  });

  test("the approval is exact, to the FACTORY, for exactly the deposit", () => {
    const built = buildRfqCreate({ client, params: params(), allowance: 0n });
    if (!built.approve) throw new Error("expected an approval");
    const approval = decodeApprove(built.approve.data);
    expect(approval.selector).toBe("0x095ea7b3");
    expect(built.approve.to.toLowerCase()).toBe(USDC.toLowerCase());
    expect(approval.spender).toBe(FACTORY.toLowerCase());
    expect(approval.spender).not.toBe(OPTION_BOOK.toLowerCase());
    expect(approval.amount).toBe(750_000n);
    expect(approval.amount).toBe(built.expected.depositBaseUnits);
    expect(built.approve.value).toBe(0n);
  });

  test("no approval when the allowance already covers the deposit", () => {
    expect(buildRfqCreate({ client, params: params(), allowance: 750_000n }).approve).toBeUndefined();
    expect(buildRfqCreate({ client, params: params(), allowance: 750_001n }).approve).toBeUndefined();
    expect(buildRfqCreate({ client, params: params(), allowance: 749_999n }).approve).toBeDefined();
  });

  test("a PUT SPREAD encodes both strikes in the factory's own DESCENDING order, whichever order they arrive in", () => {
    const ascendingInput = buildRfqCreate({ client, params: params({ strikesUsd: ["2000", "2300"] }), allowance: 0n });
    const descendingInput = buildRfqCreate({ client, params: params({ strikesUsd: ["2300", "2000"] }), allowance: 0n });

    // MEASURED against the SDK bytes: non-call, non-condor structures sort b - a.
    expect(ascendingInput.expected.strikesUsd8).toEqual([230_000_000_000n, 200_000_000_000n]);
    expect(descendingInput.expected.strikesUsd8).toEqual([230_000_000_000n, 200_000_000_000n]);
    expect(decodeCreate(ascendingInput.create.data).params.strikes).toEqual([230_000_000_000n, 200_000_000_000n]);
    expect(decodeCreate(descendingInput.create.data).params.strikes).toEqual([230_000_000_000n, 200_000_000_000n]);
    expect(ascendingInput.expected.implementation.toLowerCase()).toBe(
      (client.chainConfig.implementations.PUT_SPREAD as string).toLowerCase(),
    );
  });

  test("decimal strings survive to base units exactly, or are refused", () => {
    const cases: ReadonlyArray<readonly [string, string, bigint]> = [
      ["0.5", "1.5", 750_000n],
      ["0.015", "10", 150_000n],
      ["0.0001", "1", 100n],
      ["0.1", "3", 300_000n],
      ["0.3", "1", 300_000n],
      ["0.123456", "1", 123_456n],
      ["0.000001", "1", 1n],
      ["1.000001", "2.000002", 2_000_004n],
    ];
    for (const [reserve, contracts, deposit] of cases) {
      const built = buildRfqCreate({ client, params: params({ reservePricePerContract: reserve, numContracts: contracts }), allowance: 0n });
      expect(built.expected.depositBaseUnits).toBe(deposit);
      expect(decodeCreate(built.create.data).reservePrice).toBe(deposit);
    }
    // More decimals than USDC or a strike can hold is a refusal, never a silent round.
    expect(() => buildRfqCreate({ client, params: params({ reservePricePerContract: "0.1234567" }), allowance: 0n })).toThrowError(
      expect.objectContaining({ code: "RFQ_PRECISION_UNSUPPORTED" }),
    );
    expect(() => buildRfqCreate({ client, params: params({ numContracts: "1.5000001" }), allowance: 0n })).toThrowError(
      expect.objectContaining({ code: "RFQ_PRECISION_UNSUPPORTED" }),
    );
    expect(() => buildRfqCreate({ client, params: params({ strikesUsd: ["2300.123456789"] }), allowance: 0n })).toThrowError(
      expect.objectContaining({ code: "RFQ_PRECISION_UNSUPPORTED" }),
    );
    expect(decimalToBaseUnits("2300.5", 8, "strike")).toBe(230_050_000_000n);
  });

  test("every out-of-scope request is refused", () => {
    const refusals: ReadonlyArray<readonly [string, Partial<RfqCreateParams>]> = [
      ["RFQ_UNSUPPORTED_UNDERLYING", { underlying: "SOL" as RfqCreateParams["underlying"] }],
      ["RFQ_STRUCTURE_UNSUPPORTED", { strikesUsd: [] }],
      ["RFQ_STRUCTURE_UNSUPPORTED", { strikesUsd: ["1800", "2000", "2200"] }],
      ["RFQ_DUPLICATE_STRIKES", { strikesUsd: ["2300", "2300.0"] }],
      ["RFQ_INVALID_AMOUNT", { strikesUsd: ["0"] }],
      ["RFQ_INVALID_AMOUNT", { numContracts: "0" }],
      ["RFQ_INVALID_AMOUNT", { numContracts: "-1" }],
      ["RFQ_INVALID_AMOUNT", { numContracts: "1e6" }],
      ["RFQ_INVALID_AMOUNT", { reservePricePerContract: "0" }],
      ["RFQ_INVALID_AMOUNT", { reservePricePerContract: "abc" }],
      ["RFQ_ZERO_DEPOSIT", { reservePricePerContract: "0.000001", numContracts: "0.5" }],
      ["RFQ_INVALID_DEADLINE", { expiry: nowSeconds() + 60 }],
      ["RFQ_INVALID_DEADLINE", { offerDeadlineMinutes: 0 }],
      ["RFQ_INVALID_DEADLINE", { offerDeadlineMinutes: 1.5 }],
      ["RFQ_INVALID_PUBLIC_KEY", { requesterPublicKey: "0x04" + "11".repeat(32) }],
      ["RFQ_INVALID_PUBLIC_KEY", { requesterPublicKey: "0x0211" }],
      ["RFQ_LIMIT_ORDER_UNVERIFIED", { convertToLimitOrder: true }],
    ];
    for (const [code, overrides] of refusals) {
      expect(() => buildRfqCreate({ client, params: params(overrides), allowance: 0n })).toThrowError(
        expect.objectContaining({ code, name: "ThetanutsLogicError" }),
      );
    }
  });

  test("a client with no factory configured refuses instead of guessing an address", () => {
    const headless = {
      ...client,
      chainConfig: { ...client.chainConfig, contracts: { ...client.chainConfig.contracts, optionFactory: null } },
    } as unknown as RfqClient;
    expect(() => buildRfqCreate({ client: headless, params: params(), allowance: 0n })).toThrowError(
      expect.objectContaining({ code: "RFQ_FACTORY_UNAVAILABLE" }),
    );
    expect(() => buildRfqCancel(headless, 1n)).toThrowError(expect.objectContaining({ code: "RFQ_FACTORY_UNAVAILABLE" }));
  });
});

describe("rfq cancel and settle calldata", () => {
  test("cancel and settle decode back to their own function and id", () => {
    const cancel = buildRfqCancel(client, 784n);
    const settle = buildRfqSettle(client, 784n);
    for (const [call, name] of [[cancel, "cancelQuotation"], [settle, "settleQuotation"]] as const) {
      expect(call.to.toLowerCase()).toBe(FACTORY.toLowerCase());
      expect(call.value).toBe(0n);
      const decoded = decodeFunctionData({ abi: factoryAbi, data: call.data });
      expect(decoded.functionName).toBe(name);
      expect((decoded.args as readonly unknown[])[0]).toBe(784n);
    }
    expect(cancel.data).not.toBe(settle.data);
  });

  test("a negative quotation id is refused", () => {
    expect(() => buildRfqCancel(client, -1n)).toThrowError(expect.objectContaining({ code: "RFQ_INVALID_ID" }));
    expect(() => buildRfqSettle(client, -1n)).toThrowError(expect.objectContaining({ code: "RFQ_INVALID_ID" }));
  });
});

describe("decodeQuotationRequested", () => {
  // The topic comes from the ABI entry, never from a literal.
  const topic = encodeEventTopics({
    abi: OPTION_FACTORY_ABI as unknown as Abi,
    eventName: "QuotationRequested",
  })[0] as string;
  const idTopic = (id: bigint) => `0x${id.toString(16).padStart(64, "0")}`;
  const log = (overrides: Partial<{ address: string; topics: string[]; data: string }> = {}) => ({
    address: FACTORY,
    topics: [topic, idTopic(784n), `0x${"0".repeat(24)}${REQUESTER.slice(2)}`],
    data: "0x",
    ...overrides,
  });

  test("the module's exported topic is the ABI's own", () => {
    expect(QUOTATION_REQUESTED_TOPIC.toLowerCase()).toBe(topic.toLowerCase());
  });

  test("reads the quotation id from the factory's own log", () => {
    expect(decodeQuotationRequested([log()], FACTORY)).toEqual({ quotationId: 784n });
    expect(decodeQuotationRequested([log({ address: FACTORY.toUpperCase() })], FACTORY.toLowerCase())).toEqual({ quotationId: 784n });
    expect(decodeQuotationRequested([log({ topics: [topic, idTopic(0n)] })], FACTORY)).toEqual({ quotationId: 0n });
    // Only the FIRST factory log matters, and unrelated logs before it are skipped.
    expect(
      decodeQuotationRequested(
        [log({ address: OPTION_BOOK }), log({ topics: ["0x" + "ab".repeat(32)] }), log()],
        FACTORY,
      ),
    ).toEqual({ quotationId: 784n });
  });

  test("returns null rather than a guess", () => {
    expect(decodeQuotationRequested([], FACTORY)).toBeNull();
    // Right topic, WRONG emitter: not this factory's event.
    expect(decodeQuotationRequested([log({ address: OPTION_BOOK })], FACTORY)).toBeNull();
    expect(decodeQuotationRequested([log({ topics: [`0x${"ab".repeat(32)}`, idTopic(1n)] })], FACTORY)).toBeNull();
    expect(decodeQuotationRequested([log({ topics: [topic] })], FACTORY)).toBeNull();
    expect(decodeQuotationRequested([log({ topics: [topic, "0x01"] })], FACTORY)).toBeNull();
  });
});

describe("ThetanutsLogicError", () => {
  test("carries the RFQ codes", () => {
    try {
      buildRfqCreate({ client, params: params({ convertToLimitOrder: true }), allowance: 0n });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ThetanutsLogicError);
      expect((error as ThetanutsLogicError).code).toBe("RFQ_LIMIT_ORDER_UNVERIFIED");
    }
  });
});
