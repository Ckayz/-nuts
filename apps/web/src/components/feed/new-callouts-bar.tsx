import { Avatar } from "@/components/primitives";
import { newCallouts } from "@/lib/view-data";

/**
 * The "N new theses" pill above the feed (docs/mockups/thesis-fun-mockup.html).
 * The stacked avatars overlap with a 2px cut-out ring in the card colour, which
 * is the only zero-blur ring the design uses besides the selected-row bar.
 *
 * It is a banner, not a button: nothing loads the newer posts yet, and the
 * previous round's version was a `<div>` with a pointer cursor that did nothing
 * when clicked. It becomes a button the day it can refresh the list.
 */
export function NewCalloutsBar() {
	return (
		<div className="newbar">
			<span className="st" aria-hidden="true">
				{newCallouts.avatars.map((c) => (
					<Avatar key={c.handle} initials={c.initials} size={26} />
				))}
			</span>
			<span>
				<span className="num">{newCallouts.count}</span> new theses
			</span>
		</div>
	);
}
