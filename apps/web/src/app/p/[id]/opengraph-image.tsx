import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { positionPageData } from "@/lib/page-data";

/**
 * The same P&L card, as a share image: owner + status + date, the instrument,
 * the big signed figure with its percent, three tiles.
 *
 * It is drawn here rather than imported from `components/position/pnl-card.tsx`
 * because `ImageResponse` renders through Satori, which supports a small subset
 * of CSS — no CSS variables, no class names, and every element with more than
 * one child needs an explicit `display`. The VALUES are the same ones the page
 * renders: both read `positionPageData`, so the picture cannot disagree with the
 * page. The palette is the mockup's, written out literally for the same reason.
 *
 * TODO: load Bricolage Grotesque and JetBrains Mono at runtime when available;
 * offline generation uses ImageResponse's bundled default font, exactly as
 * `/t/[slug]`'s card does.
 */
export const alt = "Thesis.fun position";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GROUND = "#0e0e11";
const SURFACE = "#15151a";
const SURFACE_2 = "#1c1c22";
const HAIRLINE = "#26262e";
const TEXT = "#f4f4f5";
const MUTED = "#a1a1aa";
const GOLD = "#F5C542";
const BULL = "#5ee39a";
const BEAR = "#ff7a8a";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
	const page = await positionPageData((await params).id);
	if (!page) notFound();
	const { card } = page;
	const pnlColor = card.pnl.pnlClass === "bull" ? BULL : card.pnl.pnlClass === "bear" ? BEAR : TEXT;
	return new ImageResponse(
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
				background: GROUND,
				color: TEXT,
				padding: 48,
				gap: 24,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30 }}>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						width: 52,
						height: 52,
						borderRadius: 15,
						background: GOLD,
					}}
				>
					<div
						style={{
							display: "flex",
							width: 21,
							height: 21,
							borderRadius: 5,
							background: GROUND,
							transform: "rotate(45deg)",
						}}
					/>
				</div>
				<span>Thesis.fun</span>
			</div>

			<div
				style={{
					display: "flex",
					flexDirection: "column",
					flex: 1,
					background: SURFACE,
					border: `1px solid ${HAIRLINE}`,
					borderRadius: 20,
					padding: 32,
					gap: 18,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 24 }}>
					<span>{card.owner.displayName}</span>
					<span style={{ color: MUTED }}>@{card.owner.handle}</span>
					<span
						style={{
							display: "flex",
							border: `1px solid ${HAIRLINE}`,
							borderRadius: 999,
							padding: "6px 14px",
							fontSize: 20,
							color: MUTED,
						}}
					>
						{card.statusLabel}
					</span>
					<span style={{ marginLeft: "auto", color: MUTED }}>{card.dateLabel}</span>
				</div>

				<div style={{ display: "flex", fontSize: 26, color: TEXT }}>{card.instrumentLabel}</div>

				<div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
					<span style={{ fontSize: 86, fontWeight: 700, color: pnlColor }}>{card.pnl.signed2}</span>
					{card.pnlPctLabel ? (
						<span style={{ fontSize: 30, color: MUTED }}>({card.pnlPctLabel})</span>
					) : null}
				</div>
				<div style={{ display: "flex", fontSize: 22, color: MUTED }}>
					{card.pnlLabel} · {card.sideLabel}
				</div>

				<div
					style={{
						display: "flex",
						marginTop: "auto",
						background: SURFACE_2,
						border: `1px solid ${HAIRLINE}`,
						borderRadius: 14,
					}}
				>
					{card.stats.map((stat, index) => (
						<div
							key={stat.label}
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 8,
								flex: 1,
								padding: "18px 24px",
								borderLeft: index === 0 ? "none" : `1px solid ${HAIRLINE}`,
							}}
						>
							<span style={{ fontSize: 20, color: MUTED }}>{stat.label}</span>
							<span style={{ fontSize: 32 }}>{stat.value}</span>
						</div>
					))}
				</div>
			</div>
		</div>,
		size,
	);
}
