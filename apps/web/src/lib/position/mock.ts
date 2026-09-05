/**
 * `/p/[id]` against the typed fixtures.
 *
 * The fixtures record no order snapshot and no raw fill amounts — they never
 * did — so `instrument` and `quantities` are null and the card falls back to
 * whatever P&L the fixture itself states. That is the honest mapping: mock mode
 * must not manufacture an instrument the fixture does not contain.
 */
import * as data from "@/mock/data";
import type * as Domain from "@/types";
import type { PositionPageDetail } from "./types";

function ownerOf(position: Domain.Position): Domain.Creator {
	const found = data.allCreators.find((creator) => creator.id === position.userId);
	return found ?? data.currentUser;
}

export function mockPositionDetail(id: string): PositionPageDetail | undefined {
	const position = data.positionById(id);
	if (position === undefined) return undefined;
	return {
		position,
		owner: ownerOf(position),
		instrument: null,
		quantities: null,
		thesis:
			position.thesisSlug === null || position.thesisHeadline === null
				? null
				: { slug: position.thesisSlug, headline: position.thesisHeadline },
	};
}
