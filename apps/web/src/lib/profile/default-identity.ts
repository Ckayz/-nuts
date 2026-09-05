// TODO-OWNER: four digits and thesis_ handle shape. users_handle_format forbids
// hyphens; the display name preserves the owner's thesis-1234 example.
export const DEFAULT_HANDLE_RE = /^thesis_\d{4}$/;
export const DEFAULT_DISPLAY_NAME_RE = /^thesis-\d{4}$/;
const DIGITS = 4;
const RANGE = 10 ** DIGITS;

/**
 * A uniform integer in `[0, maxExclusive)` from Web Crypto.
 *
 * B-C5 (lane B confirming pass). `fill` is a TEST SEAM and nothing else — it
 * defaults to `crypto.getRandomValues`. It exists because the rejection loop
 * below cannot be reached with real randomness: 4,294,960,000 of the 2^32 draws
 * are accepted, so a suite that only takes real draws passes identically
 * against `while (false)` — the reviewer measured exactly that, 4 pass / 0 fail
 * against the mutant. `default-identity.test.ts` drives the loop with the two
 * draws that exercise it.
 */
export function cryptoRandomInt(
	maxExclusive: number,
	fill: (buffer: Uint32Array) => void = (buffer) => { crypto.getRandomValues(buffer); },
): number {
	// Reject the incomplete remainder of the uint32 range to avoid modulo bias.
	const range = 2 ** 32;
	const limit = range - range % maxExclusive;
	const buffer = new Uint32Array(1);
	let value: number;
	do { fill(buffer); value = buffer[0]!; } while (value >= limit);
	return value % maxExclusive;
}

export function generateDefaultIdentity(randomInt: (maxExclusive: number) => number = cryptoRandomInt) {
	const number = randomInt(RANGE);
	if (!Number.isInteger(number) || number < 0 || number >= RANGE) throw new RangeError("randomInt returned an out-of-range integer");
	const digits = String(number).padStart(DIGITS, "0");
	return { handle: `thesis_${digits}`, displayName: `thesis-${digits}` };
}
