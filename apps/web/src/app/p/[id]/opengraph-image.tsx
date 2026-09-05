import { ogFonts } from "@/lib/og-fonts";
import { ogText } from "@/lib/og-text";
import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { positionPageData } from "@/lib/page-data";

/**
 * The share card, as a picture: the accent frame, the near-black inner card,
 * owner + status chip + date, the instrument, the big signed figure with its
 * percent, three tiles, and the `thesis.fun` watermark on the frame's footer.
 *
 * It is drawn here rather than imported from `components/position/pnl-card.tsx`
 * because `ImageResponse` renders through Satori, which supports a small subset
 * of CSS — no CSS variables, no class names, and every element with more than
 * one child needs an explicit `display`. The VALUES are the same ones the page
 * renders: both read `positionPageData`, so the picture cannot disagree with the
 * page. The palette below is the mockup's `:root`, written out literally for the
 * same reason.
 *
 */
export const alt = "Thesis.fun position";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** docs/mockups/thesis-fun-mockup.html `:root`, lines 34-57. */
const BG = "#0b0b10";
const CARD = "#14141b";
const SURFACE_2 = "#1b1b24";
const LINE = "#25252f";
const TEXT = "#f2f2f5";
const MUTED = "#8d8d9c";
const ACCENT = "#6f5cff";
const ACCENT_LIFT = "#a99bff";
const ACCENT_TINT = "rgba(111,92,255,.14)";
const GAIN = "#22c55e";
const LOSS = "#f4634f";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
	const page = await positionPageData((await params).id);
	if (!page) notFound();
	const { card } = page;
	const pnlColor = card.pnl.pnlClass === "bull" ? GAIN : card.pnl.pnlClass === "bear" ? LOSS : TEXT;
	const settled = card.statusTone === "settled";
	// TODO-OWNER: OG typography/layout accommodates the required basis and instrument terms.
	return new ImageResponse(
		<div
			style={{
				display: "flex",
				width: "100%",
				height: "100%",
				background: BG,
				fontFamily: "Manrope",
				color: TEXT,
				padding: 28,
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					flex: 1,
					background: ACCENT,
					borderRadius: 32,
					padding: "18px 18px 14px",
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						flex: 1,
						background: CARD,
						borderRadius: 24,
						padding: "20px 28px 18px",
					}}
				>
					{/* Satori lays flex children out with no collapsing and no wrapping
					    help: every block below carries `flexShrink: 0` so a long
					    instrument can never squash the rows into each other, and the
					    sizes are chosen to fit 630px with the frame and its footer. */}
					<div style={{ display: "flex", alignItems: "center", gap: 18, flexShrink: 0 }}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 48,
								height: 48,
								flexShrink: 0,
								borderRadius: 999,
								background: SURFACE_2,
								border: `1px solid ${LINE}`,
								fontSize: 22,
								fontWeight: 700,
							}}
						>
							{ogText(card.owner.initials)}
						</div>
						<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<span style={{ fontSize: 26, fontWeight: 700 }}>{ogText(card.owner.displayName)}</span>
							<span
								style={{
									display: "flex",
									alignSelf: "flex-start",
									borderRadius: 999,
									padding: "4px 13px",
									fontSize: 19,
									fontWeight: 700,
									background: settled ? "transparent" : ACCENT_TINT,
									border: settled ? `1px solid ${LINE}` : "1px solid transparent",
									color: settled ? MUTED : ACCENT_LIFT,
								}}
							>
								{ogText(card.statusLabel)}
							</span>
						</div>
						<span style={{ marginLeft: "auto", fontSize: 22, color: MUTED }}>{ogText(card.dateLabel)}</span>
					</div>

					<div style={{ display: "flex", marginTop: 12, fontSize: 26, fontWeight: 700, flexShrink: 0 }}>
						{ogText(card.instrumentLabel)}
					</div>
					<div style={{ display: "flex", marginTop: 6, fontSize: 18, color: MUTED, flexShrink: 0 }}>
						{ogText([card.strikesLabel, card.expiryFullLabel, card.sideLabel, "Base"].filter(Boolean).join(" · "))}
					</div>

					<div style={{ display: "flex", alignItems: "baseline", gap: 20, marginTop: 10, flexShrink: 0 }}>
						<span style={{ fontSize: 56, fontWeight: 700, letterSpacing: "-0.035em", color: pnlColor }}>
							{ogText(card.pnl.signed2)}
						</span>
						{card.pnlPctLabel ? (
							<span style={{ fontSize: 28, fontWeight: 700 }}>({ogText(card.pnlPctLabel)})</span>
						) : null}
					</div>
					<div style={{ display: "flex", marginTop: 4, fontSize: 18, color: MUTED, flexShrink: 0 }}>
						{ogText(card.pnlLabel)}
					</div>
					<div style={{ display: "flex", marginTop: 6, marginBottom: 10, fontSize: 16, color: MUTED, flexShrink: 0 }}>{ogText(card.pnlBasisLabel)}</div>

					<div
						style={{
							display: "flex",
							// Pinned to the card's foot: short content puts the space above
							// the tiles, never between the figure and its label.
							marginTop: "auto",
							paddingTop: 10,
							flexShrink: 0,
							borderTop: `1px solid ${LINE}`,
						}}
					>
						{card.stats.map((stat, index) => (
							<div
								key={stat.label}
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 6,
									flex: 1,
									paddingLeft: index === 0 ? 0 : 24,
									paddingRight: 24,
									borderLeft: index === 0 ? "none" : `1px solid ${LINE}`,
								}}
							>
								<span style={{ fontSize: 18, color: MUTED }}>{ogText(stat.label)}</span>
								<span style={{ fontSize: 24, fontWeight: 700 }}>{ogText(stat.value)}</span>
							</div>
						))}
					</div>
				</div>

				<div style={{ display: "flex", alignItems: "center", padding: "10px 10px 2px", color: "#f2f2f5", flexShrink: 0 }}>
					<span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.03em" }}>thesis.fun</span>
					{/* Says "verified" only when the receipt says so (PRD 7.3). */}
					<span style={{ marginLeft: "auto", fontSize: 22, fontWeight: 600, color: "rgba(255,255,255,.72)" }}>
						{ogText(card.verified ? "Verified onchain · Base" : "Base · not confirmed yet")}
					</span>
				</div>
			</div>
		</div>,
		{ ...size, fonts: await ogFonts() },
	);
}
