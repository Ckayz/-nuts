/** Golden ASCII normalization cases, also passed to the actual SQL backfill. */
export const slugCases: ReadonlyArray<readonly [string, string]> = [
  ["BTC NFP", "btc-nfp"], ["HELLO World", "hello-world"],
  ["café déjà vu", "caf-d-j-vu"], ["東京", ""], ["🚀🔥", ""],
  ["!!!", ""], ["", ""], [" -- BTC -- ", "btc"],
  ["a___b", "a-b"], ["a.b/c", "a-b-c"], ["A\nB\tC", "a-b-c"],
  ["123 456", "123-456"], ["ETH's rally", "eth-s-rally"],
  ["İIıi", "i-i"], ["ẞß", ""], ["ＡＢＣ", ""],
  ["a\u00a0b", "a-b"], ["a\u200bb", "a-b"], ["a\ufeffb", "a-b"],
  ["one two three four five six seven", "one-two-three-four-five-six"],
  ["x".repeat(70), "x".repeat(64)],
  ["x".repeat(63) + " yz", "x".repeat(63)],
  ["ab-cd", "ab-cd"], ["e\u0301th", "e-th"], ["0", "0"],
];
