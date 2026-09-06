import Link from "next/link";
import { Avatar, StatusChip } from "@/components/primitives";
import { pnlClass, signedUsd, usd } from "@/lib/format";
import { PNL_BASIS_SHORT } from "@/lib/display";
import type { Participant, Position } from "@/lib/display-types";

/**
 * D-R3-1 (pass 3). The direction printed here is the MARKET direction the
 * canonical `positionDirection()` derived from the option, carried on the row as
 * `sideLabel`. It used to be this file's own `side === "bull"` ternary over a
 * value that meant "backed the post", so the same position could read Bull here
 * and Bear on its own page.
 */
export function PositionRows({ rows, title = "Onchain positions" }: { rows: (Position | Participant)[]; title?: string }) {
 return <section className="card"><div className="card-h"><h3>{title}</h3><span className="x num">{rows.length}</span></div><div className="card-b">
  {rows.map((row, index) => {
   const position = "id" in row ? row : null;
   // D5. The row states the lifecycle and the P&L basis instead of collapsing
   // (2026-09-06 09:5x: the basis sentence is its OWN full-width line under the
   // row — inside `.v` it forced the right column to the sentence's width and
   // truncated the title to "BTC posi…" in the rail, owner screenshot).
   // every non-settled status into one look. The status chip is the shared
   // vocabulary (`positionStatusDisplay`), and the basis is PRINTED — a `title`
   // is invisible on a phone, which is exactly where these rows are read.
   const content = <>{position ? <Avatar asset={position.asset} initials={position.asset} tone="asset" size={34} /> : "creator" in row ? <Avatar seed={row.creator.avatarSeed} initials={row.creator.initials} size={34} /> : <Avatar initials="" size={34} />}<span className="t"><b>{position ? position.thesisHeadline ?? position.asset : "creator" in row ? row.creator.displayName : ""}</b><i>{row.sideLabel === null ? null : <>{row.sideLabel} · </>}{usd(row.riskedUsd)} risked{row.contracts !== undefined ? ` · ${row.contracts} ct` : ""}{position ? <> · <StatusChip status={position.statusTone} label={position.statusLabel} /></> : null}</i></span><span className="v"><b className={`num ${pnlClass(row.livePnlUsd) === "bear" ? "loss" : pnlClass(row.livePnlUsd) === "bull" ? "gain" : "mut"}`} title={position ? position.pnlBasisLabel : undefined}>{signedUsd(row.livePnlUsd)}</b>{row.tx ? <i className="num">{row.tx.label}</i> : null}</span>{position ? <i className="basis">{position.pnlLabel} · {PNL_BASIS_SHORT[position.basis]}</i> : null}</>;
   return position ? <Link className="row position-row" href={`/p/${position.id}`} key={position.id}>{content}</Link> : row.tx ? <a className="row position-row" href={row.tx.href} key={`${row.tx.label}-${index}`}>{content}</a> : <div className="row position-row" key={index}>{content}</div>;
  })}
 </div></section>;
}
