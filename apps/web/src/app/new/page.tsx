import { Textarea } from "@nuts/ui/components/textarea";
import { Pill, TodoOwner } from "@/components/primitives";
import { marketSummaries } from "@/lib/view-data";

/**
 * The composer. Round 6 (owner 2026-09-05, "a pure text opinion is fine also"):
 * a post is text first. Naming a market is optional, naming a structure inside
 * that market is optional, and backing it with your own fill happens on the
 * market page afterwards — so there is no ticket here.
 *
 * The mockup has no composer copy beyond the rail button's title "Launch a
 * thesis" (docs/mockups/thesis-fun-mockup.html). Labels below are the minimum
 * needed to name the controls; the real copy is the owner's.
 */
export default function NewThesisPage() {
	return (
		<div className="work single">
			<main className="col">
				<div className="panel" style={{ maxWidth: "480px" }}>
					<h3>Write a post</h3>
					<div className="field">
						<label className="lbl" htmlFor="post-headline">
							Your call
						</label>
						<Textarea
							id="post-headline"
							rows={4}
							className="rounded-[9px] border-[var(--tn-l2)] bg-[var(--tn-g)] px-3 py-[9px] text-[13px] text-[var(--tn-k)]"
						/>
						<span className="note">
							Composer copy, length limits and posting rules <TodoOwner />
						</span>
					</div>
					<div className="field">
						<span className="lbl">Tag a market (optional)</span>
						<div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
							{marketSummaries.map((m) => (
								<Pill key={m.slug}>{m.asset}</Pill>
							))}
						</div>
						<span className="note">
							Markets come from live OptionBook liquidity, never a fixed list.
							Pick a structure on the market page once you have tagged one.
						</span>
					</div>
					<button type="button" className="btn primary block">
						Post
					</button>
					<span className="note">
						A post is text. It shows the verified badge only after your own fill
						on the market page confirms onchain.
					</span>
				</div>
			</main>
		</div>
	);
}
