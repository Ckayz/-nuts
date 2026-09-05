/**
 * The embedded agent panel must not own an `<h1>`.
 *
 * `/m/<asset>` renders its own `<h1>{market.name}</h1>`
 * (`app/m/[asset]/page.tsx:256`) and the agent panel beside it
 * (`app/m/[asset]/page.tsx:183`), which gave that page two — the tester measured
 * `{"h1":["ETH","Agent"]}` in a browser. The full-page variant at `/agent` is
 * the page itself and keeps the only `h1` that route has: grepped 2026-09-06,
 * nothing else under `/agent` renders one, so demoting it unconditionally would
 * have left that route with none.
 */
import { expect, test, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WagmiProvider } from "wagmi";

process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";

/**
 * The transport and the streaming runtime are not what is under test, and
 * `useChat` needs a live fetch to do anything. `@ai-sdk/react` is imported by
 * `agent-chat.tsx` alone (grepped), so replacing it wholesale reaches nothing
 * else in the process.
 */
mock.module("@ai-sdk/react", () => ({
	useChat: () => ({ messages: [], sendMessage: () => {}, status: "ready", error: undefined, addToolApprovalResponse: () => {} }),
}));

const { config } = await import("@/lib/wagmi");
const { AgentChat } = await import("./agent-chat");

function headings(variant: "page" | "panel"): { h1: number; h2: number } {
	const html = renderToStaticMarkup(
		<WagmiProvider config={config} reconnectOnMount={false}>
			<AgentChat variant={variant} />
		</WagmiProvider>,
	);
	return { h1: (html.match(/<h1[\s>]/g) ?? []).length, h2: (html.match(/<h2[\s>]/g) ?? []).length };
}

test("the embedded panel renders no h1, and the full page still renders exactly one", () => {
	const panel = headings("panel");
	const page = headings("page");
	console.log("AGENT_HEADINGS", JSON.stringify({ panel, page }));
	expect(panel).toEqual({ h1: 0, h2: 1 });
	expect(page).toEqual({ h1: 1, h2: 0 });
});
