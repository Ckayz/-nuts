import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { thesisShareData } from "@/lib/share-data";

export const alt = "Thesis.fun thesis";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const detail = thesisShareData((await params).slug);
  if (!detail) notFound();
  const { thesis, verified, pnl } = detail;
  // TODO: load Bricolage Grotesque and JetBrains Mono at runtime when available.
  // Offline generation uses ImageResponse's bundled default font.
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#0e0e11", color: "#ffffff", padding: 48, gap: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 15, background: "#F5C542" }}>
          <div style={{ display: "flex", width: 21, height: 21, borderRadius: 5, background: "#0e0e11", transform: "rotate(45deg)" }} />
        </div>
        <span>Thesis.fun</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#15151a", border: "1px solid #26262e", borderRadius: 20, padding: 32, gap: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 24 }}>
          <span>{thesis.creator.handle ? `@${thesis.creator.handle}` : thesis.creator.walletAddress}</span>
          {verified ? <span style={{ color: "#F5C542" }}>Verified</span> : null}
          {thesis.tag ? <span style={{ border: "1px solid #26262e", borderRadius: 10, padding: "6px 12px" }}>{thesis.tag.asset}</span> : null}
        </div>
        <div style={{ display: "flex", fontSize: 42, lineHeight: 1.15, flex: 1, overflow: "hidden" }}>{thesis.headline}</div>
        {thesis.structure ? <div style={{ display: "flex", fontSize: 24 }}>{`${thesis.structure.productType} · ${thesis.structure.strikesLabel} · ${thesis.structure.expiryLabel}`}</div> : null}
        {pnl && pnl.raw !== "—" ? <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 28 }}>
          <span>{thesis.backing?.creatorPnlLabel}</span>
          <span style={{ color: pnl.pnlClass === "bull" ? "#5ee39a" : pnl.pnlClass === "bear" ? "#ff7a8a" : "#ffffff" }}>{pnl.signed}</span>
        </div> : null}
      </div>
    </div>, size,
  );
}
