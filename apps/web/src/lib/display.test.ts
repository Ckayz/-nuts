import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { amount, quantity } from "./display";
import { signedUsd } from "./format";
import { btcNfp, btcNfpDetail, currentUser, ethCallsCheap, markets, nfpSetup } from "../mock/data";
import { creator, market, thesis } from "./display";

describe("decimal-string presentation", () => {
    for (const [input, usd, usd2, contracts] of [
        ["0", "$0", "$0.00", "0.0000"],
        ["0.5", "$1", "$0.50", "0.5000"],
        ["1234567.891", "$1,234,568", "$1,234,567.89", "1,234,567.8910"],
        ["-3", "−$3", "−$3.00", "-3.0000"],
        ["0.00015", "$0", "$0.00", "0.0002"],
        ["0.00000001", "$0", "$0.00", "0.00000001"],
        ["9007199254740993", "$9,007,199,254,740,993", "$9,007,199,254,740,993.00", "9,007,199,254,740,993.0000"],
        ["999.99995", "$1,000", "$1,000.00", "1,000.0000"],
        ["-0.00015", "−$0", "−$0.00", "-0.0002"],
        ["-0.00000001", "−$0", "−$0.00", "-0.00000001"],
        ["-000.000", "$0", "$0.00", "0.0000"],
        ["001.005", "$1", "$1.01", "1.0050"],
    ] as const) test(`formats ${input} exactly`, () => {
        assert.equal(amount(input).usd, usd);
        assert.equal(amount(input).usd2, usd2);
        assert.equal(quantity(input), contracts);
    });
    for (const input of ["1e5", "", " 3", "3 ", "+3", ".5", "1.", "NaN", "Infinity"]) test(`rejects ${JSON.stringify(input)}`, () => {
        assert.throws(() => amount(input), /Invalid display decimal/);
        assert.throws(() => quantity(input), /Invalid display decimal/);
    });
    test("keeps unavailable P&L distinct from actual zero", () => {
        assert.equal(signedUsd(undefined), "—");
        assert.equal(signedUsd(amount("0")), "$0");
        assert.equal(signedUsd(amount("-3")), "−$3");
        assert.equal(signedUsd(amount("3")), "+$3");
        assert.equal(amount(null).usd, "—");
        assert.equal(quantity(null), undefined);
        assert.equal(currentUser.netPnlUsd, null);
        assert.equal(signedUsd(creator(currentUser).netPnlUsd), "—");
    });
    test("creator position joins to the creator participant", () => {
        assert.equal(btcNfpDetail.participants.find(row => row.id === btcNfp.backing?.creatorPositionId)?.role, "creator");
    });
});
describe("post states", () => {
    test("a text-only post shows no market, structure, tag, backing or chip", () => {
        const view = thesis(nfpSetup);
        assert.equal(view.asset, null);
        assert.equal(view.structure, null);
        assert.equal(view.tag, null);
        assert.equal(view.backing, null);
        assert.equal(view.status, null);
        assert.equal(view.statusLabel, null);
    });
    test("a tagged post links to its market and names its structure, without a position", () => {
        const view = thesis(ethCallsCheap);
        assert.equal(view.tag?.slug, "eth");
        assert.equal(view.tag?.asset, "ETH");
        assert.equal(view.tag?.structureLabel, "2,600 / 2,800 C · 25 SEP");
        assert.equal(view.backing, null);
        assert.equal(view.statusLabel, "LIVE · 20d 09h");
    });
    test("a backed post carries the position card and the sides", () => {
        const view = thesis(btcNfp);
        assert.equal(view.tag?.structureLabel, "78,000 / 74,000 P · 11 SEP");
        assert.equal(view.backing?.creatorRiskedUsd.usd, "$1,000");
        assert.equal(view.backing?.creatorPnlLabel, "Live P&L");
        assert.equal(view.backing?.bull.amountLabel, "$7,920");
        assert.equal(view.backing?.settled, false);
    });
});
describe("market page", () => {
    test("every market prices its selected structure and counts its own book", () => {
        for (const source of markets) {
            const view = market(source);
            assert.equal(view.structureCount, source.structures.length);
            assert.equal(view.expiryCount, new Set(source.structures.map(s => s.expiryAt)).size);
            assert.equal(view.structures.filter(s => s.selected).length, 1);
            assert.equal(view.series.length, 168);
            assert.equal(view.series.at(-1)?.value.toFixed(2), source.currentSpotPriceUsd);
            assert.equal(view.series.at(-1)?.time, Math.floor(Date.parse(source.dataAsOf) / 1000));
            // Hourly, oldest first, and every point a real positive price.
            assert.ok(view.series.every((p, i) => i === 0 || p.time - view.series[i - 1]!.time === 3600));
            assert.ok(view.series.every(p => Number.isFinite(p.value) && p.value > 0));
        }
    });
    test("a market that selects a structure it does not list is rejected", () => {
        const [first] = markets;
        assert.ok(first);
        assert.throws(() => market({ ...first, selectedStructureId: "not-in-the-book" }), /selects a structure it does not list/);
    });
});
