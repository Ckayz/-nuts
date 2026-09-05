import { createAvatar } from "@dicebear/core";
import { thumbs } from "@dicebear/collection";

// TODO-OWNER: thumbs style and the existing eight avatar tone colours.
const AVATAR_BACKGROUNDS = ["5b5570", "47614f", "6b5a49", "4c5a72", "6a4f5a", "555f6b", "5e6047", "6b5152"];

/** Local, deterministic SVG; no storage or network request. */
export function avatarDataUri(seed: string): string {
	return createAvatar(thumbs, { seed, backgroundColor: AVATAR_BACKGROUNDS }).toDataUri();
}
