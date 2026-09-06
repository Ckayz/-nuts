import Link from "next/link";
import { avatarDataUri } from "@/lib/avatar";
import { assetIconPath } from "@/lib/market/asset-icon";
import { postTypeBadge } from "@/lib/post-type";
import type { CSSProperties, ReactNode } from "react";
import type { Tag, Thesis, ThesisStatus } from "@/lib/display-types";

/**
 * The shared primitives, ported from docs/mockups/thesis-fun-mockup.html.
 * Every class name below is the mockup's; the other lanes build against these.
 */

/**
 * Avatar sizes are the mockup's `.av-*` steps. The three legacy names stay so
 * components outside this round's fence keep compiling; each maps to the
 * nearest mockup step (`s` → 26, default → 34, `lg` → 40).
 *
 * K-2 (pass-4 D4-m6): `80` was admitted after `.av-80` had been deleted from
 * `index.css` as dead CSS, so passing it would have rendered an unsized avatar.
 * Nothing passed it (measured: no `size={80}` call site), and the profile hero
 * is 80px through `styles/profile.css` `.profile-avatar>.av`, not through a
 * step. The steps here are exactly the `.av-*` classes that exist.
 */
export type AvatarSize = "s" | "lg" | 22 | 26 | 30 | 34 | 40 | 44;

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
	 * A REMOTE picture the app did not generate. It outranks the generated `seed`
	 * avatar and is outranked by a vendored `asset` logo.
	 *
	 * D-N2: this comment used to promise that a remote picture which FAILS TO
	 * LOAD falls back to the generated avatar. It does not — there is no `onError`
	 * handler below, and a dead URL draws a broken image. The `seed` fallback
	 * applies only when `src` is ABSENT. Nothing in the app passes `src` today
	 * (the Farcaster rail dropped it); a caller that wants remote pictures has to
	 * add the failure handling first.
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
 * The lifecycle chip, and the ONE place a status becomes a chip class.
 *
 * The mockup gives an open position the accent chip and a settled one the flat
 * chip; `ending` reads as still open, so it keeps the accent.
 *
 * D-n2 (lane D confirming pass). Three list rows used to build the class by
 * hand as `chip ${statusTone}`, which emits `chip settled` / `chip live` /
 * `chip ending` — none of which `index.css` defines, so every one of them fell
 * back to the plain ACCENT chip while `PnlCard` drew the same settled position
 * with `chip flat`. The reviewer measured `ROW ["<span class=\"chip settled\">"]`
 * against `CARD ["<span class=\"chip flat\">"]`. Every caller goes through this
 * component now, so a status has exactly one look.
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

/**
 * The post type pill: fomo marks every feed post with one
 * (docs/design/FOMO-DIGEST.md, "Feed"). Our words, not theirs — `Thesis` for a
 * pure text opinion, `Bull` / `Bear` for the direction the post names.
 * `lib/post-type.ts` owns the rule, the vocabulary and the reason the direction
 * cannot be read off the structure or the backing card; this is only its
 * markup.
 *
 * RULE TENSION, recorded rather than resolved here. CLAUDE.md: "Colour only on
 * money (never bars, labels, names)." A badge is a label, so the pill itself
 * stays neutral — surface ground, hairline, muted or plain text — and the money
 * colour appears only on the 6px dot. That is the same compromise CLAUDE.md
 * already makes one sentence later for the percent beside a P&L ("neutral with
 * a coloured arrow"). TODO-OWNER: if the owner wants fomo's fully tinted pill,
 * it is a colour change on `.ptype.bull` / `.ptype.bear` in `index.css` and
 * nothing here moves.
 */
export function PostTypeBadge({ thesis }: { thesis: Pick<Thesis, "direction"> }) {
	const badge = postTypeBadge(thesis);
	return (
		<span className={badge.tone === "neutral" ? "ptype" : `ptype ${badge.tone}`}>
			<span className="dot" aria-hidden />
			{badge.label}
		</span>
	);
}

/**
 * Marks a value the OWNER decides — a preset, a ranking rule, a limit, a line of
 * copy. CLAUDE.md: "Product numbers and copy are the owner's … Never invent a
 * value." The marker is how an unset value stays visible instead of being
 * quietly guessed.
 *
 * It renders only OUTSIDE production. 38 of these were rendering on the
 * deployed site, where a grey "TODO-OWNER" badge on the feed is the first thing
 * a visitor reads and says the product is unfinished. In `next dev` every one is
 * still on screen, so the outstanding decisions stay in front of the team.
 *
 * This hides the marker, NOT the decision: the value underneath is still a
 * placeholder, and the `TODO-OWNER` comment beside it in the source is what the
 * team works from. Deleting the call sites would lose that record, which is why
 * they stay.
 */
export function TodoOwner({ style }: { style?: CSSProperties }) {
	if (process.env.NODE_ENV === "production") return null;
	return (
		<span className="todo" style={style}>
			TODO-OWNER
		</span>
	);
}

/**
 * K-2 (CL-10). The same rule for a note whose WORDS ARE the placeholder.
 *
 * `TodoOwner` above hides the MARKER in production, which is right when the
 * sentence beside it is real copy the owner may still change. It is wrong when
 * the "sentence" is itself the open question: `/new` shipped a visible line
 * reading "Composer copy, length limits and posting rules" and three leaderboard
 * footers ended "…settlements. Ranking formula", with only the badge hidden — so
 * a visitor read the team's own to-do list as product copy. MEASURED on a
 * db-mode production build before this: `span.mut.compose-note` on `/new` was
 * 616x20, `display:block`, `visibility:visible`.
 *
 * Wrapping the placeholder WORDS (not the real sentence they sit beside) hides
 * them together with the marker, and keeps the decision on the record exactly
 * where `TodoOwner` keeps it: in the source, at the call site.
 */
export function TodoOwnerNote({ children, className }: { children: ReactNode; className?: string }) {
	if (process.env.NODE_ENV === "production") return null;
	return (
		<span className={className}>
			{children} <TodoOwner />
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
