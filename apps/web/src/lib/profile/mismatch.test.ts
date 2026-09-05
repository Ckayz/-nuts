/**
 * B-P3-2 (lane B pass 3, MAJOR). Profile editing under an UNRESOLVED wallet
 * mismatch.
 *
 * G-4 gave the Like, Follow and comment controls a two-part protection: the
 * control is the signed-out control while the connected wallet and the server
 * session disagree, and the action refuses a claim that is not the session's
 * wallet. Profile editing had neither. The reviewer's measurement on the
 * unfixed code, session A with wallet B connected:
 *
 *   SAVE           [{"disabled":false,"text":"Save"}]
 *   PROFILE_WRITES [{"handle":"alice","displayName":"Changed while B","bio":""}]
 *   ACTION         {"profile":{"displayName":"Changed while B",…}}
 *   ACTOR          [{"id":"c0000000-0000-4000-8000-000000000001",…}]
 *
 * Both halves run in CHILD PROCESSES: `mock.module` is process-wide in bun, and
 * `@/lib/profile/actions`, `@/lib/auth/session` and `next/navigation` are all
 * imported by other files in this suite. Same reason and same shape as
 * `components/auth/connected-identity.test.tsx`.
 */
import { describe, expect, test } from "bun:test";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";

function run(script: string): Record<string, unknown> {
	const child = Bun.spawnSync([process.execPath, "--preload", "./test/setup.ts", "-e", script], {
		cwd: new URL("../../..", import.meta.url).pathname,
		env: {
			...process.env,
			DATABASE_URL: "",
			DIRECT_DATABASE_URL: "",
			SKIP_ENV_VALIDATION: "1",
			AI_GATEWAY_API_KEY: "",
			OPENROUTER_API_KEY: "offline-test",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	if (child.exitCode !== 0) throw new Error(child.stderr.toString());
	return JSON.parse(child.stdout.toString()) as Record<string, unknown>;
}

describe("B-P3-2: the profile form under a mismatched identity", () => {
	test("Save is disabled with the shared sentence, and a submit writes nothing", () => {
		const measured = run(String.raw`
			import { mock } from "bun:test";
			mock.module("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));
			const writes = [];
			mock.module("@/lib/profile/actions", () => ({
				updateProfile: async (...args) => { writes.push(args); return { error: "mock_stop" }; },
			}));
			const { publishConnectedIdentity, resetConnectedIdentity } = await import("./src/components/auth/connected-identity.ts");
			const { ProfileEditor } = await import("./src/components/creator/profile-editor.tsx");
			const { mount } = await import("./src/test/hook-runner.ts");
			globalThis.FormData = class {
				get(key) { return { handle: "alice", displayName: "Changed while B", bio: "" }[key]; }
			};

			// 1. Identities disagree: disabled, explained, and it writes nothing.
			publishConnectedIdentity({ mismatched: true, address: "${B}" });
			const bad = mount(ProfileEditor, { profile: { handle: "alice", displayName: "Alice", bio: null }, walletAddress: "${A}" });
			const save = bad.buttons()[0];
			const mismatchedState = {
				disabled: save.props.disabled === true,
				title: save.props.title ?? null,
				fields: bad.find(e => e.type === "input" || e.type === "textarea").map(e => e.props.disabled === true),
				sentence: bad.text().includes("Sign in using the wallet control"),
			};
			bad.find(e => e.type === "form")[0].props.onSubmit({ preventDefault() {}, currentTarget: {} });
			await bad.settle();
			const blockedWrites = writes.length;

			// 2. Identities agree: the same form saves, and says which wallet it holds.
			resetConnectedIdentity();
			publishConnectedIdentity({ mismatched: false, address: "${A}" });
			const good = mount(ProfileEditor, { profile: { handle: "alice", displayName: "Alice", bio: null }, walletAddress: "${A}" });
			const enabled = good.buttons()[0].props.disabled === true;
			good.find(e => e.type === "form")[0].props.onSubmit({ preventDefault() {}, currentTarget: {} });
			await good.settle();
			console.log(JSON.stringify({ mismatchedState, blockedWrites, enabled, writes }));
		`);
		expect(measured).toEqual({
			mismatchedState: {
				disabled: true,
				title: "Sign in using the wallet control",
				fields: [true, true, true],
				sentence: true,
			},
			blockedWrites: 0,
			enabled: false,
			// The wallet the browser holds travels with the call, so the server can
			// refuse a write whose two identities disagree.
			writes: [[{ handle: "alice", displayName: "Changed while B", bio: "" }, A]],
		});
	});

	test("the action refuses a differing wallet and allows a matching or absent one", () => {
		const measured = run(String.raw`
			import { mock } from "bun:test";
			const session = { userId: "c0000000-0000-4000-8000-000000000001", walletAddress: "${A}" };
			const real = await import("./src/lib/auth/session.ts");
			mock.module("@/lib/auth/session", () => ({ ...real, getSession: async () => session }));
			const { updateProfile } = await import("./src/lib/profile/actions.ts");
			const input = { handle: "alice", displayName: "Changed while B", bio: "" };
			console.log(JSON.stringify({
				differing: await updateProfile(input, "${B}"),
				matching: await updateProfile(input, "${A}"),
				uppercase: await updateProfile(input, "${A}".toUpperCase()),
				absent: await updateProfile(input),
				empty: await updateProfile(input, ""),
			}));
		`);
		expect(measured).toEqual({
			// Refused before anything is read or written.
			differing: { error: "sign_in_required" },
			empty: { error: "sign_in_required" },
			// Past the guard; stopped by the data-source switch instead, which is
			// what "the guard did not refuse this" looks like offline.
			matching: { error: "mock_mode" },
			uppercase: { error: "mock_mode" },
			absent: { error: "mock_mode" },
		});
	});

	test("the action's guard is the SAME one the social writes use", () => {
		const source = Bun.file(new URL("./actions.ts", import.meta.url).pathname);
		return source.text().then((text) => {
			expect(text).toContain('import { walletGuard } from "../social/guards"');
			expect(text).toContain("const wrongWallet = walletGuard(session.walletAddress, walletAddress);");
			// Before the data-source switch and before any read or write.
			expect(text.indexOf("walletGuard(")).toBeLessThan(text.indexOf("usingDatabase()"));
		});
	});
});
