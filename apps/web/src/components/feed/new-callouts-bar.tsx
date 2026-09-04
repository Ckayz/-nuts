import { Avatar } from "@/components/primitives";
import { newCallouts } from "@/mock/data";

export function NewCalloutsBar() {
	return (
		<div className="newbar">
			<span className="st">
				{newCallouts.avatars.map((c) => (
					<Avatar key={c.handle} initials={c.initials} size="s" />
				))}
			</span>
			<b>+{newCallouts.count} new callouts</b>
			<span>· show</span>
		</div>
	);
}
