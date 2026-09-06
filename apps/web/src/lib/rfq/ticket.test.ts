/**
 * The RFQ ticket. Offline: every entry point takes the signing secret
 * explicitly, so nothing here depends on how this checkout is configured.
 *
 * The load-bearing property is the LAST test: an RFQ ticket and a trade ticket
 * travel over the same surface and are signed with the same key, and neither
 * decoder may accept the other's token.
 */
import { describe, expect, test } from "bun:test";
import { encodeTradeTicket, decodeTradeTicket, type TradeTicketPayload } from "@/lib/trade/ticket";
import { decodeRfqTicket, encodeRfqTicket, type RfqTicketPayload } from "./ticket";

const secret = "a".repeat(48);

const payload = (over: Partial<RfqTicketPayload> = {}): RfqTicketPayload => ({
	v: 1,
	kind: "rfq_create",
	userId: "11111111-1111-4111-8111-111111111111",
	wallet: "0x1111111111111111111111111111111111111111",
	chainId: 8453,
	rfqRequestId: "22222222-2222-4222-8222-222222222222",
	factory: "0x8118dad971debffb49b9280047659174128a8b94",
	quotationId: null,
	depositBaseUnits: "2500000",
	issuedAt: 1_788_000_000,
	...over,
});

describe("the RFQ ticket", () => {
	test("round trips every field", () => {
		const original = payload({ kind: "rfq_settle", quotationId: "125", depositBaseUnits: null });
		expect(decodeRfqTicket(encodeRfqTicket(original, secret), secret)).toEqual(original);
	});

	test("a tampered body is rejected, not partly trusted", () => {
		const token = encodeRfqTicket(payload(), secret);
		const [body = "", signature = ""] = token.split(".");
		const forged = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as RfqTicketPayload;
		const swapped = { ...forged, wallet: "0x2222222222222222222222222222222222222222" };
		const reencoded = Buffer.from(JSON.stringify(swapped), "utf8").toString("base64url");
		expect(decodeRfqTicket(`${reencoded}.${signature}`, secret)).toBeNull();
	});

	test("another key cannot mint one", () => {
		const token = encodeRfqTicket(payload(), "b".repeat(48));
		expect(decodeRfqTicket(token, secret)).toBeNull();
	});

	test("malformed, wrong-chain, wrong-version and unknown-kind tokens all decode to null", () => {
		expect(decodeRfqTicket("", secret)).toBeNull();
		expect(decodeRfqTicket("nodot", secret)).toBeNull();
		expect(decodeRfqTicket(".sig", secret)).toBeNull();
		const wrongChain = { ...payload(), chainId: 1 } as unknown as RfqTicketPayload;
		expect(decodeRfqTicket(encodeRfqTicket(wrongChain, secret), secret)).toBeNull();
		const wrongVersion = { ...payload(), v: 2 } as unknown as RfqTicketPayload;
		expect(decodeRfqTicket(encodeRfqTicket(wrongVersion, secret), secret)).toBeNull();
		const wrongKind = { ...payload(), kind: "trade" } as unknown as RfqTicketPayload;
		expect(decodeRfqTicket(encodeRfqTicket(wrongKind, secret), secret)).toBeNull();
	});

	/**
	 * DOMAIN SEPARATION. Both tickets are HMACs over base64url JSON under
	 * `getSessionSecret()`, so without the domain prefix a trade ticket's
	 * signature would verify as an RFQ ticket's and the reverse — and
	 * `recordRfqCreateFor` would accept a token minted by the OptionBook path.
	 * A mutant that gives `lib/rfq/ticket.ts` the trade DOMAIN turns this red.
	 */
	test("neither decoder accepts the other's token", () => {
		const trade: TradeTicketPayload = {
			v: 1,
			userId: payload().userId,
			wallet: payload().wallet,
			chainId: 8453,
			structureId: "abc",
			instrumentLabel: "ETH put 2450 P",
			side: "bull",
			taker: "buy",
			thesisId: null,
			role: "standalone",
			positionSide: "back",
			optionBook: "0x1bdff855d6811728acadc00989e79143a2bdfded",
			budget: "1000000",
			collateralAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
			collateralSymbol: "USDC",
			collateralDecimals: 6,
			contractSizeDecimals: 6,
			expectedContracts: "1",
			expectedPremium: "1",
			expectedFee: "0",
			expectedCollateral: "0",
			maxLossUsd8: null,
			maxPayoutUsd8: null,
			breakEvenUsd8: null,
			orderSnapshot: { v: 1 } as unknown as TradeTicketPayload["orderSnapshot"],
			issuedAt: 1_788_000_000,
		};
		const tradeToken = encodeTradeTicket(trade, secret);
		const rfqToken = encodeRfqTicket(payload(), secret);

		expect(decodeTradeTicket(tradeToken, secret)).not.toBeNull();
		expect(decodeRfqTicket(rfqToken, secret)).not.toBeNull();

		expect(decodeRfqTicket(tradeToken, secret)).toBeNull();
		expect(decodeTradeTicket(rfqToken, secret)).toBeNull();
	});
});
