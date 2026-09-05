import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { amount, quantity } from "./display";
import { signedUsd } from "./format";
import { btcNfp, btcNfpDetail, currentUser } from "../mock/data";
import { creator } from "./display";

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
        assert.equal(btcNfpDetail.participants.find(row => row.id === btcNfp.creatorPositionId)?.role, "creator");
    });
});
