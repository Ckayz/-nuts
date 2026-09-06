/**
 * K-2 (CL-10). An internal note whose WORDS are the placeholder must not ship.
 *
 * `TodoOwner` hides the MARKER in production (owner default 4). Four call sites
 * put the open question itself in the sentence rather than beside it, so
 * production rendered the team's to-do list as product copy — measured on a
 * db-mode production build at the base commit: `/new` rendered
 * `span.mut.compose-note` 616x20, `display:block`, `visibility:visible`,
 * reading "Composer copy, length limits and posting rules"; `/`, `/portfolio`
 * and `/u/<handle>` each ended their leaderboard footer
 * "…settlements. Ranking formula".
 *
 * `NODE_ENV` is read at RENDER time, and this suite must not mutate it for
 * every other file sharing the process, so each case renders in its OWN child
 * process with `NODE_ENV` set on the command — the same shape
 * `lib/data/source.test.ts` uses for the same reason.
 */
import { expect, test } from "bun:test";

const APP_ROOT = new URL("../..", import.meta.url).pathname;

/** Renders one component to static markup in a child process at a given NODE_ENV. */
function renderIn(nodeEnv: string, jsx: string): string {
	const script = `
		const { renderToStaticMarkup } = await import("react-dom/server");
		const React = await import("react");
		const { TodoOwner, TodoOwnerNote } = await import("./src/components/primitives.tsx");
		void TodoOwner;
		console.log("MARKUP:" + JSON.stringify(renderToStaticMarkup(${jsx})));
	`;
	const child = Bun.spawnSync([process.execPath, "-e", script], {
		cwd: APP_ROOT,
		env: {
			...process.env,
			NODE_ENV: nodeEnv,
			DATABASE_URL: "postgresql://user:pw@127.0.0.1:5432/fixture",
			SESSION_SECRET: "x".repeat(32),
			DATA_SOURCE: "db",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = child.stdout.toString();
	if (child.exitCode !== 0) throw new Error(`${child.stderr.toString()}\n${out}`);
	const line = out.split("\n").find((part) => part.startsWith("MARKUP:"));
	if (line === undefined) throw new Error(`no markup:\n${out}\n${child.stderr.toString()}`);
	return JSON.parse(line.slice("MARKUP:".length)) as string;
}

const NOTE = 'React.createElement(TodoOwnerNote, { className: "mut compose-note" }, "Composer copy, length limits and posting rules")';

test("a TodoOwnerNote renders nothing at all in production", () => {
	expect(renderIn("production", NOTE)).toBe("");
});

test("a TodoOwnerNote still shows the words and the marker outside production", () => {
	const html = renderIn("development", NOTE);
	expect(html).toContain("Composer copy, length limits and posting rules");
	expect(html).toContain("TODO-OWNER");
	expect(html).toContain('class="mut compose-note"');
});

test("the real sentence beside a note survives production; only the note's words go", () => {
	const footer =
		'React.createElement("div", { className: "card-f" }, "P&L is 1W, from onchain fills and settlements.", React.createElement(TodoOwnerNote, null, " Ranking formula"))';
	const prod = renderIn("production", footer);
	expect(prod).toContain("P&amp;L is 1W, from onchain fills and settlements.");
	expect(prod).not.toContain("Ranking formula");
	const dev = renderIn("development", footer);
	expect(dev).toContain("Ranking formula");
	expect(dev).toContain("TODO-OWNER");
});

/**
 * The four call sites, pinned at the source so the wrapper cannot be quietly
 * unwrapped again. Every OTHER `<TodoOwner />` in the app sits beside a real
 * sentence and is deliberately left alone.
 */
const SITES: Array<[string, string]> = [
	["src/app/new/composer.tsx", "Composer copy, length limits and posting rules"],
	["src/app/page.tsx", " Ranking formula"],
	["src/app/u/[handle]/page.tsx", " Ranking formula"],
	["src/app/portfolio/page.tsx", " Ranking formula"],
];

test("the four placeholder-only notes are wrapped, not bare", async () => {
	for (const [path, words] of SITES) {
		const source = await Bun.file(`${APP_ROOT}${path}`).text();
		expect(source).toContain(`<TodoOwnerNote`);
		expect(source).toContain(`${words}</TodoOwnerNote>`);
	}
});
