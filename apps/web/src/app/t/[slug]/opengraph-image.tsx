import { ogFonts } from "@/lib/og-fonts";
import { ogText, ogTextOrNull } from "@/lib/og-text";
import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { thesisShareData } from "@/lib/share-data";

export const alt = "Thesis.fun thesis";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const detail = await thesisShareData((await params).slug);
  if (!detail) notFound();
  const { thesis, verified, pnl } = detail;
  const bodyText = ogTextOrNull(thesis.note);
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", fontFamily: "Manrope", background: "#070511", color: "#f7f7f7", padding: 48, gap: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 15, background: "#f7f7f7" }}>
          <div style={{ display: "flex", width: 21, height: 21, borderRadius: 5, fontFamily: "Manrope", background: "#070511", transform: "rotate(45deg)" }} />
        </div>
        <span>Thesis.fun</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#181623", border: "1px solid #282438", borderRadius: 20, padding: 32, gap: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 24 }}>
          <span>{ogTextOrNull(thesis.creator.handle ? `@${thesis.creator.handle}` : thesis.creator.walletAddress)}</span>
          {verified ? <span style={{ color: "#f7f7f7" }}>Verified</span> : null}
          {thesis.tag ? <span style={{ border: "1px solid #282438", borderRadius: 10, padding: "6px 12px" }}>{ogText(thesis.tag.asset)}</span> : null}
        </div>
        <div style={{ display: "flex", fontSize: 42, lineHeight: 1.15, overflow: "hidden" }}>{ogText(thesis.headline)}</div>
        {/* m10 (user-flow re-walk 2026-09-06): only the handle, the asset chip
            and the headline were drawn, so roughly the lower 60% of a 1200x630
            card was empty while the position card
            (`app/p/[id]/opengraph-image.tsx`) fills the same space with the
            share card's own rows. The mockup's share card
            (docs/mockups/thesis-fun-mockup.html line 928, "3 · POSITION — the
            share card is the hero") is the reference for what a card carries:
            who, what, the number. The post's own words are the "what" here, so
            the rationale takes the empty region and nothing else is added.

            Clipped by the box, not by a string cut: `flex: 1` plus
            `overflow: hidden` lets a long post fill the space and stop, which
            is what the headline row already did. `ogTextOrNull` is the same
            emoji-stripping helper every other string on this card goes
            through — Satori would otherwise fetch a twemoji SVG per emoji. */}
        {bodyText ? <div style={{ display: "flex", fontSize: 26, lineHeight: 1.35, flex: 1, overflow: "hidden", color: "#9899a3" }}>{bodyText}</div> : <div style={{ display: "flex", flex: 1 }} />}
        {thesis.structure ? <div style={{ display: "flex", fontSize: 24 }}>{ogText(`${thesis.structure.productType} · ${thesis.structure.strikesLabel} · ${thesis.structure.expiryLabel}`)}</div> : null}
        {pnl && pnl.raw !== "—" ? <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 28 }}>
          <span>{ogTextOrNull(thesis.backing?.creatorPnlLabel)}</span>
          <span style={{ color: pnl.pnlClass === "bull" ? "#1cce59" : pnl.pnlClass === "bear" ? "#fd6536" : "#f7f7f7" }}>{ogText(pnl.signed)}</span>
        </div> : null}
      </div>
    </div>, { ...size, fonts: await ogFonts() },
  );
}
