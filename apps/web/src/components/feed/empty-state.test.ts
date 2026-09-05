import { expect, test } from "bun:test";
import {
	AUDIENCE_ALL,
	AUDIENCE_FOLLOWING,
	AUDIENCE_TOP,
	RANKING_ENDING,
	RANKING_SETTLED,
	RANKING_TRENDING,
	feedEmptyState,
} from "./empty-state";

const RANKINGS = [RANKING_TRENDING, RANKING_ENDING, RANKING_SETTLED];
const AUDIENCES = [AUDIENCE_ALL, AUDIENCE_FOLLOWING, AUDIENCE_TOP];

test("every tab pair has a line and an action; none is the old bare string", () => {
	for (const audience of AUDIENCES) {
		for (const ranking of RANKINGS) {
			const state = feedEmptyState(audience, ranking);
			expect(state.line.length, `${audience}/${ranking}`).toBeGreaterThan(0);
			expect(state.action.length, `${audience}/${ranking}`).toBeGreaterThan(0);
			expect(state.line).not.toBe("Nothing here yet.");
		}
	}
});

test("an empty Following says something different from an empty All", () => {
	expect(feedEmptyState(AUDIENCE_FOLLOWING, RANKING_TRENDING).line).not.toBe(
		feedEmptyState(AUDIENCE_ALL, RANKING_TRENDING).line,
	);
	expect(feedEmptyState(AUDIENCE_FOLLOWING, RANKING_TRENDING).line).toContain("follow");
});

test("audience outranks ranking, so the reason stays true across all three pills", () => {
	const lines = RANKINGS.map((ranking) => feedEmptyState(AUDIENCE_FOLLOWING, ranking).line);
	expect(new Set(lines).size).toBe(1);
});

test("the three All-audience rankings each state their own reason", () => {
	const lines = RANKINGS.map((ranking) => feedEmptyState(AUDIENCE_ALL, ranking).line);
	expect(new Set(lines).size).toBe(3);
	expect(feedEmptyState(AUDIENCE_ALL, RANKING_ENDING).line).toContain("expiry");
	expect(feedEmptyState(AUDIENCE_ALL, RANKING_SETTLED).line).toContain("settled");
});

test("an unknown tab index still yields the neutral line rather than throwing", () => {
	expect(feedEmptyState(99, 99).line).toBe(feedEmptyState(AUDIENCE_ALL, RANKING_TRENDING).line);
});

test("no line promises data that is loading", () => {
	for (const audience of AUDIENCES) {
		for (const ranking of RANKINGS) {
			const { line } = feedEmptyState(audience, ranking);
			expect(line.toLowerCase()).not.toContain("loading");
			expect(line.toLowerCase()).not.toContain("coming soon");
		}
	}
});
