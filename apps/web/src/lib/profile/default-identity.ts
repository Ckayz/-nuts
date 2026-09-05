// TODO-OWNER: four digits and thesis_ handle shape. users_handle_format forbids
// hyphens; the display name preserves the owner's thesis-1234 example.
export const DEFAULT_HANDLE_RE = /^thesis_\d{4}$/;
export const DEFAULT_DISPLAY_NAME_RE = /^thesis-\d{4}$/;
const DIGITS = 4;
const RANGE = 10 ** DIGITS;

function cryptoRandomInt(maxExclusive: number): number {
	// Reject the incomplete remainder of the uint32 range to avoid modulo bias.
	const range = 2 ** 32;
	const limit = range - range % maxExclusive;
	const buffer = new Uint32Array(1);
	let value: number;
	do { crypto.getRandomValues(buffer); value = buffer[0]!; } while (value >= limit);
	return value % maxExclusive;
}

export function generateDefaultIdentity(randomInt: (maxExclusive: number) => number = cryptoRandomInt) {
	const number = randomInt(RANGE);
	if (!Number.isInteger(number) || number < 0 || number >= RANGE) throw new RangeError("randomInt returned an out-of-range integer");
	const digits = String(number).padStart(DIGITS, "0");
	return { handle: `thesis_${digits}`, displayName: `thesis-${digits}` };
}
