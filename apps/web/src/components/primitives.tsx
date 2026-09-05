import Link from "next/link";
import { avatarDataUri } from "@/lib/avatar";
import { assetIconPath } from "@/lib/market/asset-icon";
import type { CSSProperties, ReactNode } from "react";
import type { Tag, ThesisStatus } from "@/lib/display-types";

/**
 * The shared primitives, ported from docs/mockups/thesis-fun-mockup.html.
 * Every class name below is the mockup's; the other lanes build against these.
 */

/**
 * Avatar sizes are the mockup's `.av-*` steps. The three legacy names stay so
 * components outside this round's fence keep compiling; each maps to the
 * nearest mockup step (`s` → 26, default → 34, `lg` → 40).
 */
export type AvatarSize = "s" | "lg" | 22 | 26 | 30 | 34 | 40 | 44 | 80;

const AVATAR_STEP: Record<string, number> = { s: 26, lg: 40 };

/**
 * The mockup gives each person one of eight muted background classes and every
 * asset the neutral `.av-asset` treatment. The eight fixture creators (MK NS GA
 * DV JL 0X TB RH) are mapped by their own monogram so their colours are the
 * mockup's exactly; anyone else gets a stable colour from the same eight, hashed
 * off the monogram so a person keeps one colour everywhere.
 */
const AVATAR_TONES = ["a-mk", "a-ns", "a-ga", "a-dv", "a-jl", "a-0x", "a-tb", "a-rh"] as const;
const AVATAR_BY_INITIALS: Record<string, string> = {
	MK: "a-mk", NS: "a-ns", GA: "a-ga", DV: "a-dv",
	JL: "a-jl", "0X": "a-0x", TB: "a-tb", RH: "a-rh",
};

export function avatarTone(initials: string): string {
	const exact = AVATAR_BY_INITIALS[initials.toUpperCase()];
	if (exact !== undefined) return exact;
	let hash = 0;
	for (const char of initials.toUpperCase()) hash = (hash * 31 + char.charCodeAt(0)) % 4096;
	return AVATAR_TONES[hash % AVATAR_TONES.length]!;
}

/** Brand logos knowingly bend "colour only on money" by the owner’s order. */
export function Avatar({
	initials,
	seed,
	asset,
	src,
	size,
	tone,
	className,
	style,
	"aria-label": ariaLabel,
}: {
	initials: string;
	seed?: string;
	asset?: string;
	/**
	 * A REMOTE picture the app did not generate — today only a Farcaster
	 * `author.pfp_url`, which callers must already have narrowed to https
	 * (`lib/farcaster/casts.ts`). It outranks the generated `seed` avatar and is
	 * outranked by a vendored `asset` logo. When it is absent, or when the remote
	 * image fails to load, the generated avatar and then the monogram remain the
	 * fallback, so a person is never drawn as a broken image.
	 */
	src?: string;
	size?: AvatarSize;
	/** `asset` renders the mockup's neutral ticker avatar instead of a person. */
	tone?: "person" | "asset";
	className?: string;
	style?: CSSProperties;
	"aria-label"?: string;
}) {
	const step = typeof size === "number" ? size : AVATAR_STEP[size ?? ""] ?? 34;
	const isAsset = tone === "asset" || asset !== undefined;
	const assetSrc = asset !== undefined ? assetIconPath(asset) : null;
	const dataUri = !isAsset && seed ? avatarDataUri(seed) : null;
	// Precedence: a vendored asset logo, then a caller-supplied remote picture,
	// then the generated avatar. An asset never takes a remote `src`.
	const remoteSrc = isAsset ? null : src;
	const imageSrc = assetSrc ?? remoteSrc ?? dataUri;
	const colour = isAsset ? "av-asset" : avatarTone(initials);
	return (
		<span
			className={`av av-${step} ${colour}${className ? ` ${className}` : ""}`}
			style={style}
			aria-label={ariaLabel}
			aria-hidden={ariaLabel === undefined ? true : undefined}
		>
			{imageSrc ? <img src={imageSrc} alt="" width={step} height={step} draggable={false} referrerPolicy={imageSrc.startsWith("https:") ? "no-referrer" : undefined} style={{ display: "block", width: "100%", height: "100%", borderRadius: "50%" }} /> : initials}
		</span>
	);
}

/** The mockup's `.chip`: accent tint by default, neutral when `flat`. */
export function Chip({
	children,
	flat,
	style,
}: {
	children: ReactNode;
	flat?: boolean;
	style?: CSSProperties;
}) {
	return (
		<span className={flat ? "chip flat" : "chip"} style={style}>
			{children}
		</span>
	);
}

/**
 * The lifecycle chip. The mockup gives an open position the accent chip and a
 * settled one the flat chip; `ending` reads as still open, so it keeps the
 * accent. Signature unchanged — `pnl-card.tsx` and the post header both use it.
 */
export function StatusChip({
	status,
	label,
	style,
}: {
	status: ThesisStatus;
	label: string;
	style?: CSSProperties;
}) {
	return (
		<Chip flat={status === "settled"} style={style}>
			{label}
		</Chip>
	);
}

export function TodoOwner({ style }: { style?: CSSProperties }) {
	return (
		<span className="todo" style={style}>
			TODO-OWNER
		</span>
	);
}

/**
 * The market and structure chips a post is tagged with. A post that names no
 * market renders nothing; the chips are the only route from a post to trading.
 *
 * The market chip is the mockup's `.mtag` (asset avatar + "<Name> market"); the
 * structure and the "no position yet" note stay as neutral chips beside it,
 * because a post can carry all three and the mockup only draws the one case.
 */
export function TagRow({ tag, backed, thesisId }: { tag: Tag | null; backed?: boolean; thesisId: string }) {
	if (!tag) return null;
	return (
		<div className="tags">
			<Link className="mtag" href={`/m/${tag.slug}?thesis=${thesisId}`}>
				<Avatar asset={tag.asset} initials={tag.asset} tone="asset" size={26} />
				{tag.asset} market
			</Link>
			{tag.structureLabel ? (
				<Link className="mtag" href={`/m/${tag.slug}?thesis=${thesisId}`} style={{ paddingLeft: "12px" }}>
					{tag.structureLabel}
				</Link>
			) : null}
			{backed ? null : <Chip flat>no position yet</Chip>}
		</div>
	);
}
