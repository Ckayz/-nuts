/**
 * B-R2 (lane B pass 2), second half: while the connected wallet and the server
 * session disagree, the social controls must be the SIGNED-OUT controls.
 *
 * The reviewer measured the hole at the actions ("`toggleLike`, `toggleFollow`,
 * and `addComment` pass `getSession().userId` directly to their writers.
 * WalletBar's mismatch handling does not disable those controls across the
 * application"), so the proofs here are behavioural at both ends: the store and
 * its hook are mounted and driven, and the four controls are rendered through
 * `react-dom/server` in both states. The click path — that the connected wallet
 * actually reaches the server action — runs in a child process, because the
 * module substitution it needs is process-wide in bun.
 */
import { expect, test, describe, afterEach } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mount } from "@/test/hook-runner";
import {
	connectedIdentity,
	publishConnectedIdentity,
	resetConnectedIdentity,
	subscribeConnectedIdentity,
	useConnectedIdentity,
} from "./connected-identity";
import { LikeButton } from "@/components/feed/like-button";
import { FollowButton } from "@/components/creator/follow-button";
import { CreatorStats } from "@/components/creator/creator-stats";
import { CommentForm } from "@/components/thesis/comment-form";
import type { Creator } from "@/lib/display-types";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";

afterEach(() => {
	resetConnectedIdentity();
});

describe("the connected-identity store", () => {
	test("starts as nobody, and a publish reaches every subscriber", () => {
		expect(connectedIdentity()).toEqual({ mismatched: false, address: null });
		const seen: unknown[] = [];
		const stop = subscribeConnectedIdentity((value) => seen.push(value));
		subscribeConnectedIdentity((value) => seen.push(value));
		publishConnectedIdentity({ mismatched: true, address: B });
		expect(seen).toEqual([
			{ mismatched: true, address: B },
			{ mismatched: true, address: B },
		]);
		expect(connectedIdentity()).toEqual({ mismatched: true, address: B });
		stop();
		publishConnectedIdentity({ mismatched: false, address: A });
		expect(seen).toHaveLength(3);
	});

	test("re-publishing the same identity notifies nobody", () => {
		let calls = 0;
		subscribeConnectedIdentity(() => {
			calls += 1;
		});
		publishConnectedIdentity({ mismatched: true, address: B });
		publishConnectedIdentity({ mismatched: true, address: B });
		expect(calls).toBe(1);
		// The address alone is a change: same person, different wallet.
		publishConnectedIdentity({ mismatched: true, address: A });
		expect(calls).toBe(2);
	});
});

test("useConnectedIdentity re-renders on a publish and unsubscribes on unmount", () => {
	const seen: string[] = [];
	function Probe() {
		const identity = useConnectedIdentity();
		seen.push(`${identity.mismatched}:${identity.address}`);
		return createElement("div", null, `${identity.mismatched}`);
	}
	const h = mount(Probe, {});
	expect(h.text()).toBe("false");
	publishConnectedIdentity({ mismatched: true, address: B });
	h.flush();
	expect(h.text()).toBe("true");
	expect(seen.at(-1)).toBe(`true:${B}`);
	publishConnectedIdentity({ mismatched: false, address: A });
	h.flush();
	expect(h.text()).toBe("false");
	const rendered = seen.length;
	h.unmount();
	publishConnectedIdentity({ mismatched: true, address: B });
	h.flush();
	expect(seen).toHaveLength(rendered);
});

const creator: Creator = {
	id: "c0000000-0000-4000-8000-000000000001",
	handle: "someone",
	handleLabel: "someone",
	displayName: "Someone",
	initials: "SO",
	avatarSeed: "seed",
	followerCount: 2,
} as Creator;

/**
 * Every social control, in the state a signed-in person in database mode sees.
 *
 * `blocked` names the element the disabled state has to land on. The comment
 * form's SUBMIT button is disabled by an empty draft as well, which says
 * nothing about identity, so its textarea is the honest witness.
 */
const controls: ReadonlyArray<{ name: string; markup: () => string; blocked: RegExp }> = [
	{
		name: "LikeButton",
		blocked: /<button[^>]*\bdisabled=/,
		markup: () =>
			renderToStaticMarkup(
				<LikeButton thesisId="t-1" likes={3} liked={false} signedIn databaseMode />,
			),
	},
	{
		name: "FollowButton",
		blocked: /<button[^>]*\bdisabled=/,
		markup: () =>
			renderToStaticMarkup(
				<FollowButton creatorId={creator.id} following={false} signedIn databaseMode />,
			),
	},
	{
		name: "CreatorStats follow",
		blocked: /<button[^>]*\bdisabled=/,
		markup: () => renderToStaticMarkup(<CreatorStats creator={creator} signedIn databaseMode />),
	},
	{
		name: "CommentForm",
		blocked: /<textarea[^>]*\bdisabled=/,
		markup: () =>
			renderToStaticMarkup(
				<CommentForm
					thesisId="t-1"
					signedIn
					databaseMode
					onMockComment={() => {}}
					onPending={() => {}}
				/>,
			),
	},
];

describe("a mismatched identity disables every social control", () => {
	for (const control of controls) {
		test(`${control.name}: enabled while the identities agree`, () => {
			publishConnectedIdentity({ mismatched: false, address: A });
			const html = control.markup();
			expect(html).not.toMatch(control.blocked);
			expect(html).not.toContain("Sign in using the wallet control");
		});

		test(`${control.name}: disabled with the existing hint while they disagree`, () => {
			publishConnectedIdentity({ mismatched: true, address: B });
			const html = control.markup();
			expect(html).toMatch(control.blocked);
			// The SAME sentence the signed-out state already used. No new copy.
			expect(html).toContain("Sign in using the wallet control");
		});
	}
});

/**
 * The click path. `@/lib/social/actions` has to be substituted to see the
 * arguments, and a bun module substitution is process-wide — it would follow
 * every other test in this file — so it runs in its own process.
 */
test("a control calls its action with the connected wallet, and sends nothing while mismatched", () => {
	const script = String.raw`
		import { plugin } from "bun";
		const calls = [];
		plugin({ name: "social-actions-probe", setup(build) {
			const record = (name) => async (...args) => { calls.push([name, ...args]); return {}; };
			build.module("@/lib/social/actions", () => ({ exports: {
				toggleLike: record("toggleLike"),
				toggleFollow: record("toggleFollow"),
				addComment: record("addComment"),
			}, loader: "object" }));
		}});
		const { mount } = await import("./src/test/hook-runner.ts");
		const { publishConnectedIdentity } = await import("./src/components/auth/connected-identity.ts");
		const { LikeButton } = await import("./src/components/feed/like-button.tsx");
		const { FollowButton } = await import("./src/components/creator/follow-button.tsx");
		const { CommentForm } = await import("./src/components/thesis/comment-form.tsx");
		const A = "${A}";

		// 1. Identities agree: every control sends, and says which wallet it holds.
		publishConnectedIdentity({ mismatched: false, address: A });
		const like = mount(LikeButton, { thesisId: "t-1", likes: 1, liked: false, signedIn: true, databaseMode: true });
		like.click(like.buttons()[0]);
		await like.settle();
		const follow = mount(FollowButton, { creatorId: "c-1", following: false, signedIn: true, databaseMode: true });
		follow.click(follow.buttons()[0]);
		await follow.settle();
		const comment = mount(CommentForm, { thesisId: "t-1", signedIn: true, databaseMode: true, onMockComment: () => {}, onPending: () => {} });
		const submit = comment.find(e => e.type === "form")[0];
		const textarea = comment.find(e => e.type === "textarea")[0];
		textarea.props.onChange({ target: { value: "hello" } });
		comment.flush();
		comment.find(e => e.type === "form")[0].props.onSubmit({ preventDefault() {} });
		await comment.settle();
		if (submit === undefined) throw new Error("no form");

		// 2. Identities disagree: the same controls are disabled and send nothing.
		publishConnectedIdentity({ mismatched: true, address: "${B}" });
		like.flush(); follow.flush(); comment.flush();
		const blocked = [
			like.buttons()[0].props.disabled,
			follow.buttons()[0].props.disabled,
			comment.find(e => e.type === "textarea")[0].props.disabled,
			comment.buttons()[0].props.disabled,
		];
		comment.find(e => e.type === "form")[0].props.onSubmit({ preventDefault() {} });
		await comment.settle();
		console.log(JSON.stringify({ calls, blocked }));
	`;
	const child = Bun.spawnSync([process.execPath, "--preload", "./test/setup.ts", "-e", script], {
		cwd: new URL("../../..", import.meta.url).pathname,
		env: { ...process.env, DATABASE_URL: "", SKIP_ENV_VALIDATION: "1" },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({ code: 0, stderr: "" });
	expect(JSON.parse(child.stdout.toString())).toEqual({
		calls: [
			["toggleLike", "t-1", true, A],
			["toggleFollow", "c-1", true, A],
			["addComment", "t-1", "hello", A],
		],
		blocked: [true, true, true, true],
	});
});

/**
 * The wiring, end to end: the header's wallet control is the only publisher, so
 * if it stops publishing every proof above goes quiet while still passing. This
 * mounts the REAL `WalletBar` — wagmi, the router and the auth server actions
 * substituted, nothing of the component itself — and reads the store after each
 * account change. Its own process, for the same reason as the click test.
 */
test("WalletBar publishes the identity the whole app reads", () => {
	const script = String.raw`
		import { plugin } from "bun";
		const A = "${A}";
		// Mixed case on purpose: what is published must be comparable.
		const B = "0x00000000000000000000000000000000000000bB";
		let connected = { address: A, isConnected: true, chainId: 8453 };
		plugin({ name: "wallet-bar-identity-probe", setup(build) {
			build.module("wagmi", () => ({ exports: {
				useConnection: () => connected,
				useConnect: () => ({ connect: () => {}, connectors: [], isPending: false, error: null }),
				useDisconnect: () => ({ disconnect: () => {} }),
				useSignMessage: () => ({ signMessageAsync: async () => "0x" }),
				useSwitchChain: () => ({ switchChain: () => {} }),
			}, loader: "object" }));
			build.module("@/lib/wagmi", () => ({ exports: { config: { chains: [{ id: 8453, name: "Base" }], connectors: [] } }, loader: "object" }));
			build.module("next/navigation", () => ({ exports: { useRouter: () => ({ refresh: () => {} }) }, loader: "object" }));
			build.module("@/lib/auth/actions", () => ({ exports: {
				readSignInSession: async () => ({ walletAddress: A, truncatedAddress: "0x00…00aa" }),
				requestSignInChallenge: async () => ({ message: "m", nonce: "n" }),
				// The failing sign-out IS the case: the session survives the switch.
				signOut: async () => { throw new Error("offline"); },
				verifySignInSignature: async () => ({ ok: false, reason: "signature_invalid" }),
			}, loader: "object" }));
		}});
		const { mount } = await import("./src/test/hook-runner.ts");
		const { connectedIdentity } = await import("./src/components/auth/connected-identity.ts");
		const { WalletBar } = await import("./src/components/auth/wallet-bar.tsx");
		const h = mount(WalletBar, {});
		await h.settle();
		const sameAccount = connectedIdentity();
		connected = { address: B, isConnected: true, chainId: 8453 };
		h.setProps({});
		await h.settle();
		const switched = connectedIdentity();
		connected = { address: undefined, isConnected: false, chainId: undefined };
		h.setProps({});
		await h.settle();
		console.log(JSON.stringify({ sameAccount, switched, disconnected: connectedIdentity() }));
	`;
	const child = Bun.spawnSync([process.execPath, "--preload", "./test/setup.ts", "-e", script], {
		cwd: new URL("../../..", import.meta.url).pathname,
		env: { ...process.env, DATABASE_URL: "", SKIP_ENV_VALIDATION: "1" },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({ code: 0, stderr: "" });
	expect(JSON.parse(child.stdout.toString())).toEqual({
		sameAccount: { mismatched: false, address: A },
		switched: { mismatched: true, address: B },
		// A disconnected wallet contradicts nothing (`accountMismatch`), so the
		// session stays usable and only the address goes.
		disconnected: { mismatched: false, address: null },
	});
});
