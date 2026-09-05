/** Access preformatted display values; domain parsing lives only in display.ts. */
import type { DisplayAmount } from "./display-types";
export function usd(value: DisplayAmount) { return value.usd; }
export function usd2(value: DisplayAmount) { return value.usd2; }
export function signedUsd(value: DisplayAmount | undefined) { return value?.signed ?? "$0"; }
export function pnlClass(value: DisplayAmount | undefined) { return value?.pnlClass ?? ""; }
