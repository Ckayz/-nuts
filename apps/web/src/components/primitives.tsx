import type { CSSProperties } from "react";
import type { ThesisStatus } from "@/types";

export function Avatar({
	initials,
	size,
}: {
	initials: string;
	size?: "s" | "lg";
}) {
	return <span className={size ? `av ${size}` : "av"}>{initials}</span>;
}

export function StatusChip({
	status,
	label,
	style,
}: {
	status: ThesisStatus;
	label: string;
	style?: CSSProperties;
}) {
	const mod = status === "live" ? "" : ` ${status}`;
	return (
		<span className={`live${mod}`} style={style}>
			{label}
		</span>
	);
}

/**
 * The single-colour Bull split bar; the remainder stays neutral.
 * Inside a settled post the CSS (`.post.settled .bar i`) greys the fill.
 */
export function Bar({ pct, style }: { pct: number; style?: CSSProperties }) {
	return (
		<div className="bar" style={style}>
			<i style={{ width: `${pct}%` }} />
		</div>
	);
}

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
				<span className="bull">{bullLabel}</span>
				<span className={bearMuted ? "mut" : "bear"}>{bearLabel}</span>
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
	children: React.ReactNode;
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
