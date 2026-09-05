/**
 * m3 (Opus user-flow tester) — the floating "✦ Ask" launcher doubled the panel.
 *
 * `app/layout.tsx:42` mounts `AgentLauncher` on every route, and two routes
 * already embed the same chat: `/agent` full-page (`app/agent/page.tsx:30`) and
 * `/m/<asset>` as a panel (`app/m/[asset]/page.tsx:183`). Pressing the launcher
 * there opened a SECOND conversation over the first.
 *
 * The guard has to live in the launcher: `app/layout.tsx` has no "use client"
 * (measured), so it is a server component and cannot read the pathname.
 */
import { expect, test, mock } from "bun:test";
import * as realNavigation from "next/navigation";

process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";

/**
 * Only `usePathname` is replaced. `mock.module` is process-wide in bun, and
 * `next/navigation`'s `notFound`, `redirect` and `permanentRedirect` are used by
 * server modules other suites exercise — a wholesale replacement would break
 * them silently (the same lesson `test/trade-mocks.ts` records for wagmi).
 */
let currentPath = "/";
mock.module("next/navigation", () => ({ ...realNavigation, usePathname: () => currentPath }));

const { mount } = await import("@/test/hook-runner");
const { AgentLauncher, launcherHiddenOn } = await import("./agent-launcher");

function askButtonAt(pathname: string): boolean {
	currentPath = pathname;
	const ui = mount(AgentLauncher as unknown as (props: never) => ReturnType<typeof AgentLauncher>, {});
	try {
		return ui.button(/Ask/) !== null;
	} finally {
		ui.unmount();
	}
}

test("m3: the rule hides the launcher exactly on the routes that embed the chat", () => {
	for (const path of ["/agent", "/agent/", "/m/eth", "/m/btc", "/m/eth?structure=x"]) {
		expect({ path, hidden: launcherHiddenOn(path) }).toEqual({ path, hidden: true });
	}
	// Everything else keeps it, including routes whose names merely START with the
	// same letters — a bare `startsWith("/m")` would have swallowed these.
	for (const path of ["/", "/portfolio", "/new", "/markets", "/me", "/p/abc", "/u/someone", "/t/slug"]) {
		expect({ path, hidden: launcherHiddenOn(path) }).toEqual({ path, hidden: false });
	}
});

test("m3: mounted on each route, the launcher renders only where no chat is embedded", () => {
	const seen = {
		feed: askButtonAt("/"),
		agent: askButtonAt("/agent"),
		market: askButtonAt("/m/eth"),
		portfolio: askButtonAt("/portfolio"),
	};
	console.log("M3_LAUNCHER", JSON.stringify(seen));
	expect(seen).toEqual({ feed: true, agent: false, market: false, portfolio: true });
});

test("m3: on a hidden route it renders nothing at all, not a hidden control", () => {
	currentPath = "/m/eth";
	const ui = mount(AgentLauncher as unknown as (props: never) => ReturnType<typeof AgentLauncher>, {});
	try {
		expect(ui.text()).toBe("");
		expect(ui.buttons()).toEqual([]);
	} finally {
		ui.unmount();
	}
});
