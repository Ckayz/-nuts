import Link from "next/link";
import { Avatar } from "@/components/primitives";
import { pnlClass, signedUsd, usd } from "@/lib/format";
import type { Participant, Position } from "@/lib/display-types";

export function PositionRows({ rows }: { rows: (Position | Participant)[] }) {
 return <section className="card"><div className="card-h"><h3>Onchain positions</h3><span className="x num">{rows.length}</span></div><div className="card-b">
  {rows.map((row, index) => {
   const position = "id" in row ? row : null;
   // D5. The row states the lifecycle and the P&L basis instead of collapsing
   // every non-settled status into one look. The status chip is the shared
   // vocabulary (`POSITION_STATUS_DISPLAY`), and the basis sentence is the
   // card's own, exposed as a title so a number is never shown without saying
   // where it came from.
   const content = <><span className="av av-34 av-asset" aria-hidden="true">{position ? position.asset : <Avatar initials={"creator" in row ? row.creator.initials : ""} size="s" />}</span><span className="t"><b>{position ? position.thesisHeadline ?? position.asset : "creator" in row ? row.creator.displayName : ""}</b><i>{row.side === "bull" ? "Bull" : "Bear"} · {usd(row.riskedUsd)} risked{row.contracts !== undefined ? ` · ${row.contracts} ct` : ""}{position ? <> · <span className={`chip ${position.statusTone}`}>{position.statusLabel}</span></> : null}</i></span><span className="v"><b className={`num ${pnlClass(row.livePnlUsd) === "bear" ? "loss" : pnlClass(row.livePnlUsd) === "bull" ? "gain" : "mut"}`} title={position ? position.pnlBasisLabel : undefined}>{signedUsd(row.livePnlUsd)}</b>{position ? <i>{position.pnlLabel}</i> : null}{row.tx ? <i className="num">{row.tx.label}</i> : null}</span></>;
   return position ? <Link className="row position-row" href={`/p/${position.id}`} key={position.id}>{content}</Link> : row.tx ? <a className="row position-row" href={row.tx.href} key={`${row.tx.label}-${index}`}>{content}</a> : <div className="row position-row" key={index}>{content}</div>;
  })}
 </div></section>;
}
