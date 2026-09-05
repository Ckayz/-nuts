import Link from "next/link";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import type { DisplayAmount, Tag, ThesisStatus } from "@/lib/display-types";

/**
 * The shared primitives, ported from docs/mockups/thesis-fun-mockup.html.
 * Every class name below is the mockup's; the other lanes build against these.
 */

/**
 * Avatar sizes are the mockup's `.av-*` steps. The three legacy names stay so
 * components outside this round's fence keep compiling; each maps to the
 * nearest mockup step (`s` → 26, default → 34, `lg` → 40).
 */
export type AvatarSize = "s" | "lg" | 26 | 30 | 34 | 40 | 44 | 80;

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

export function Avatar({
	initials,
	size,
	tone,
	className,
	style,
	"aria-label": ariaLabel,
}: {
	initials: string;
	size?: AvatarSize;
	/** `asset` renders the mockup's neutral ticker avatar instead of a person. */
	tone?: "person" | "asset";
	className?: string;
	style?: CSSProperties;
	"aria-label"?: string;
}) {
	const step = typeof size === "number" ? size : AVATAR_STEP[size ?? ""] ?? 34;
	const colour = tone === "asset" ? "av-asset" : avatarTone(initials);
	return (
		<span
			className={`av av-${step} ${colour}${className ? ` ${className}` : ""}`}
			style={style}
			aria-label={ariaLabel}
			aria-hidden={ariaLabel === undefined ? true : undefined}
		>
			{initials}
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

/** A money figure: tabular numerals, colour from the amount, never from a label. */
export function Money({
	amount,
	className,
	style,
}: {
	amount: DisplayAmount | undefined;
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<span
			className={`num ${amount?.pnlClass ?? ""}${className ? ` ${className}` : ""}`}
			style={style}
		>
			{amount?.signed ?? "—"}
		</span>
	);
}

export type ButtonVariant = "acc" | "sec" | "out";

export function buttonClass(
	variant: ButtonVariant = "sec",
	options?: { block?: boolean; big?: boolean; className?: string },
): string {
	return [
		"btn",
		variant,
		options?.block ? "block" : "",
		options?.big ? "big" : "",
		options?.className ?? "",
	]
		.filter(Boolean)
		.join(" ");
}

/** The mockup's `.btn` with its three variants. */
export function Button({
	variant = "sec",
	block,
	big,
	className,
	...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: ButtonVariant;
	block?: boolean;
	big?: boolean;
}) {
	return <button {...rest} className={buttonClass(variant, { block, big, className })} />;
}

/**
 * The single-colour Bull split bar.
 *
 * RETIRED BY THE ROUND-1 MOCKUP: the fomo-feel spec draws no bars at all —
 * colour is for money only. It stays exported, with a neutral track, because
 * `/t/[slug]` and `components/thesis/share-panel.tsx` are another lane's files
 * this round. Delete both with those pages.
 */
export function Bar({ pct, style }: { pct: number; style?: CSSProperties }) {
	return (
		<div className="bar" style={style}>
			<i style={{ width: `${pct}%` }} />
		</div>
	);
}

/** See `Bar`: retired by the round-1 mockup, kept until `/t/[slug]` is rebuilt. */
export function SplitBar({
	bullLabel,
	bearLabel,
	bullPct,
	bearMuted,
	rowStyle,
	barStyle,
	style,
}: {
	bullLabel: string;
	bearLabel: string;
	bullPct: number;
	bearMuted?: boolean;
	rowStyle?: CSSProperties;
	barStyle?: CSSProperties;
	style?: CSSProperties;
}) {
	return (
		<div className="sent" style={style}>
			<div className="row2" style={rowStyle}>
				<span>{bullLabel}</span>
				<span className={bearMuted ? "mut" : undefined}>{bearLabel}</span>
			</div>
			<Bar pct={bullPct} style={barStyle} />
		</div>
	);
}

export function Pill({
	children,
	on,
	style,
}: {
	children: ReactNode;
	on?: boolean;
	style?: CSSProperties;
}) {
	return (
		<span className={on ? "pill on" : "pill"} style={style}>
			{children}
		</span>
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
export function TagRow({ tag, backed }: { tag: Tag | null; backed?: boolean }) {
	if (!tag) return null;
	return (
		<div className="tags">
			<Link className="mtag" href={`/m/${tag.slug}`}>
				<Avatar initials={tag.asset} tone="asset" size={26} />
				{tag.asset} market
			</Link>
			{tag.structureLabel ? (
				<Link className="mtag" href={`/m/${tag.slug}`} style={{ paddingLeft: "12px" }}>
					{tag.structureLabel}
				</Link>
			) : null}
			{backed ? null : <Chip flat>no position yet</Chip>}
		</div>
	);
}
