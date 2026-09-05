import Link from "next/link";
import { Avatar } from "@/components/primitives";
import { pnlClass, signedUsd, usd } from "@/lib/format";
import type { Participant, Position } from "@/lib/display-types";

export function PositionRows({ rows, title = "Onchain positions" }: { rows: (Position | Participant)[]; title?: string }) {
 return <section className="card"><div className="card-h"><h3>{title}</h3><span className="x num">{rows.length}</span></div><div className="card-b">
  {rows.map((row, index) => {
   const position = "id" in row ? row : null;
   const content = <>{position ? <Avatar asset={position.asset} initials={position.asset} tone="asset" size={34} /> : "creator" in row ? <Avatar seed={row.creator.avatarSeed} initials={row.creator.initials} size={34} /> : <Avatar initials="" size={34} />}<span className="t"><b>{position ? position.thesisHeadline ?? position.asset : "creator" in row ? row.creator.displayName : ""}</b><i>{row.side === "bull" ? "Bull" : "Bear"} · {usd(row.riskedUsd)} risked{row.contracts !== undefined ? ` · ${row.contracts} ct` : ""}{position?.settled ? " · settled" : ""}</i></span><span className="v"><b className={`num ${pnlClass(row.livePnlUsd) === "bear" ? "loss" : pnlClass(row.livePnlUsd) === "bull" ? "gain" : "mut"}`}>{signedUsd(row.livePnlUsd)}</b>{row.tx ? <i className="num">{row.tx.label}</i> : null}</span></>;
   return position ? <Link className="row position-row" href={`/p/${position.id}`} key={position.id}>{content}</Link> : row.tx ? <a className="row position-row" href={row.tx.href} key={`${row.tx.label}-${index}`}>{content}</a> : <div className="row position-row" key={index}>{content}</div>;
  })}
 </div></section>;
}
