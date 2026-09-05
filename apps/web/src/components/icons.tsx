/** SVG paths copied verbatim from docs/mockups/thesis-fun-mockup.html. */

type Props = { className?: string; style?: React.CSSProperties };

function Svg({
	children,
	strokeWidth = 2,
	...rest
}: Props & { children: React.ReactNode; strokeWidth?: number }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			aria-hidden="true"
			{...rest}
		>
			{children}
		</svg>
	);
}

export function HomeIcon(props: Props) {
	return (
		<Svg {...props}>
			<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
		</Svg>
	);
}

export function ExploreIcon(props: Props) {
	return (
		<Svg {...props}>
			<circle cx="12" cy="12" r="9" />
			<path d="M15 9l-2 6-4 2 2-6z" />
		</Svg>
	);
}

export function TapeIcon(props: Props) {
	return (
		<Svg {...props}>
			<circle cx="12" cy="12" r="2.5" />
			<path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16" />
		</Svg>
	);
}

export function PortfolioIcon(props: Props) {
	return (
		<Svg {...props}>
			<path d="M3 17l5-6 4 4 4-7 5 5" />
			<path d="M3 21h18" />
		</Svg>
	);
}

export function LeaderboardIcon(props: Props) {
	return (
		<Svg {...props}>
			<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />
			<path d="M7 6H4a3 3 0 0 0 3 3M17 6h3a3 3 0 0 1-3 3" />
		</Svg>
	);
}

export function PlusIcon(props: Props) {
	return (
		<Svg strokeWidth={2.5} {...props}>
			<path d="M12 5v14M5 12h14" />
		</Svg>
	);
}

export function SearchIcon(props: Props) {
	return (
		<Svg {...props}>
			<circle cx="11" cy="11" r="7" />
			<path d="M20 20l-3.5-3.5" />
		</Svg>
	);
}

/** `filled` is the liked state: the mockup fills the same path with currentColor. */
export function HeartIcon({ filled, ...props }: Props & { filled?: boolean }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill={filled ? "currentColor" : "none"}
			stroke="currentColor"
			strokeWidth={2}
			aria-hidden="true"
			{...props}
		>
			<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z" />
		</svg>
	);
}

export function CommentIcon(props: Props) {
	return (
		<Svg {...props}>
			<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" />
		</Svg>
	);
}

export function ShareIcon(props: Props) {
	return (
		<Svg {...props}>
			<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v13M7 8l5-5 5 5" />
		</Svg>
	);
}

export function MarketIcon(props: Props) {
	return (
		<Svg {...props}>
			<path d="M7 4v3M7 17v3M17 4v3M17 17v3" />
			<rect x="4" y="7" width="6" height="10" rx="1.5" />
			<rect x="14" y="7" width="6" height="10" rx="1.5" />
		</Svg>
	);
}

export function CheckIcon(props: Props) {
	return (
		<Svg strokeWidth={2.5} {...props}>
			<path d="M20 6L9 17l-5-5" />
		</Svg>
	);
}

export function SparkIcon(props: Props) {
	return (
		<Svg {...props}>
			<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
		</Svg>
	);
}
