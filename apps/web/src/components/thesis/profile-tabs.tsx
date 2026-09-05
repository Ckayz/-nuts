"use client";
import { useId, useState, type ReactNode } from "react";
export function ProfileTabs({ positions, posts }: { positions: ReactNode; posts: ReactNode }) {
 const [tab, setTab] = useState(0);
 const id = useId();
 return <><div className="tabs" role="tablist" aria-label="Profile">
  {["Positions", "Posts"].map((label, index) => <button key={label} id={`${id}-tab-${index}`} role="tab" type="button" aria-selected={tab === index} aria-controls={`${id}-panel-${index}`} tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)} onKeyDown={event => {
   if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
   event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - tab; setTab(next); document.getElementById(`${id}-tab-${next}`)?.focus();
  }}>{label}</button>)}
 </div>{[positions, posts].map((content,index) => <div key={index} id={`${id}-panel-${index}`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`} hidden={tab !== index} tabIndex={0}>{content}</div>)}</>;
}
