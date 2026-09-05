import { expect, test, describe } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Connector } from "wagmi";

import { config } from "@/lib/wagmi";

import { ConnectDialog, walletChoices } from "./connect-dialog";
import { isWalletRejection, networkLabel } from "./wallet-bar";

/**
 * Enough of a Connector to exercise the picker.
 *
 * `type` matters: wagmi gives every injected-family connector `type: "injected"`
 * (the generic one keeps `id: "injected"`, an EIP-6963 announcement gets the
 * wallet's rdns as its id), while an SDK connector such as Coinbase carries its
 * own type. The picker's fallback rule reads both fields.
 */
function connector(id: string, name: string, icon?: string, type = "injected"): Connector {
	return { uid: `uid-${id}-${name}`, id, name, icon, type } as unknown as Connector;
}

describe("walletChoices", () => {
	test("drops the generic 'Injected' row when a real wallet announced itself", () => {
		// wagmi's injected() with no target reports its name as the literal string
		// "Injected", and EIP-6963 discovery is on by default — so MetaMask arrives
		// twice, once anonymously and once by name.
		const choices = walletChoices([
			connector("injected", "Injected"),
			connector("coinbaseWalletSDK", "Coinbase Wallet", undefined, "coinbaseWallet"),
			connector("io.metamask", "MetaMask"),
		]);
		expect(choices.map((c) => c.name)).toEqual(["Coinbase Wallet", "MetaMask"]);
	});

	test("keeps the generic row when nothing else was discovered", () => {
		// A browser wallet that does not announce itself must stay reachable.
		const choices = walletChoices([connector("injected", "Injected")]);
		expect(choices.map((c) => c.name)).toEqual(["Injected"]);
	});

	// The two cases below run the ACTUAL configured connectors from lib/wagmi.ts.
	// The picker previously treated every non-`injected` connector as "discovered",
	// so the always-configured Coinbase SDK connector evicted the generic fallback
	// in every browser and a wallet that only sets `window.ethereum` was unreachable.
	test("offers the generic fallback alongside Coinbase when nothing announced itself", () => {
		expect(config.connectors.map((c) => c.id)).toEqual(["injected", "coinbaseWalletSDK"]);
		const choices = walletChoices(config.connectors);
		expect(choices.map((c) => c.id)).toEqual(["injected", "coinbaseWalletSDK"]);
	});

	test("drops the generic fallback once a wallet announces itself, keeping Coinbase", () => {
		// EIP-6963 discovery appends an injected-type connector keyed by rdns.
		const announced = connector("io.metamask", "MetaMask");
		const choices = walletChoices([...config.connectors, announced]);
		expect(choices.map((c) => c.id)).toEqual(["coinbaseWalletSDK", "io.metamask"]);
	});

	test("an SDK connector alone is not an announcement", () => {
		// Coinbase's own type is "coinbaseWallet", so its presence must not count
		// as EIP-6963 discovery.
		const choices = walletChoices([
			connector("injected", "Injected"),
			connector("coinbaseWalletSDK", "Coinbase Wallet", undefined, "coinbaseWallet"),
		]);
		expect(choices.map((c) => c.id)).toEqual(["injected", "coinbaseWalletSDK"]);
	});

	test("shows one row per wallet when the same wallet arrives twice", () => {
		const choices = walletChoices([
			connector("coinbaseWallet", "Coinbase Wallet"),
			connector("com.coinbase.wallet", "Coinbase Wallet"),
		]);
		expect(choices).toHaveLength(1);
	});

	test("matches names case- and whitespace-insensitively", () => {
		const choices = walletChoices([
			connector("a", "Rabby"),
			connector("b", "  rabby "),
		]);
		expect(choices).toHaveLength(1);
	});

	test("returns nothing when there are no connectors at all", () => {
		expect(walletChoices([])).toEqual([]);
	});
});

describe("networkLabel", () => {
	test("names the configured chain", () => {
		expect(networkLabel(8453)).toBe("Base");
	});

	test("names an unrecognised chain by its number rather than inventing one", () => {
		// The old code printed a fixture string, so it read "Base" on Ethereum.
		expect(networkLabel(1)).toBe("Chain 1");
	});

	test("says nothing when no chain is known", () => {
		expect(networkLabel(undefined)).toBeNull();
	});
});

describe("ConnectDialog", () => {
	const props = {
		connectors: [connector("io.metamask", "MetaMask", "data:image/svg+xml;base64,AAA")],
		pending: false,
		error: null,
		onSelect: () => {},
		onClose: () => {},
	};

	test("is a labelled modal dialog", () => {
		const html = renderToStaticMarkup(<ConnectDialog {...props} />);
		expect(html).toContain('role="dialog"');
		expect(html).toContain('aria-modal="true"');
		expect(html).toContain('aria-labelledby="connect-dialog-title"');
	});

	test("names the wallet and shows the icon the connector supplied", () => {
		const html = renderToStaticMarkup(<ConnectDialog {...props} />);
		expect(html).toContain("MetaMask");
		expect(html).toContain("data:image/svg+xml;base64,AAA");
	});

	test("tells the user when no wallet is installed, instead of offering a dead button", () => {
		const html = renderToStaticMarkup(<ConnectDialog {...props} connectors={[]} />);
		expect(html).toContain("No wallet detected");
	});

	test("surfaces a connect failure", () => {
		// The old code never read useConnect().error, so this was silent.
		const html = renderToStaticMarkup(
			<ConnectDialog {...props} error="That wallet is not available in this browser." />,
		);
		expect(html).toContain("That wallet is not available");
		expect(html).toContain('role="status"');
	});

	test("disables the rows while a connection is in flight", () => {
		const html = renderToStaticMarkup(<ConnectDialog {...props} pending />);
		expect(html).toContain("disabled");
	});
});

describe("isWalletRejection", () => {
	test("recognises the EIP-1193 rejection code, nested in a cause chain", () => {
		expect(isWalletRejection({ cause: { cause: { code: 4001 } } })).toBe(true);
	});

	test("treats an unrecognised failure as real, not as a cancellation", () => {
		// Staying silent about a genuine outage is the bug this guards.
		expect(isWalletRejection(new Error("network unreachable"))).toBe(false);
	});

	test("survives a cyclic cause chain", () => {
		const a: { cause?: unknown } = {};
		a.cause = a;
		expect(isWalletRejection(a)).toBe(false);
	});
});

/**
 * D-R3-m1 / F24 (Astra lane D, pass 3): a sign-in failure was rendered ONLY
 * inside a closed `<details>` menu, so a click on the visible "Sign in" button
 * could fail with nothing to read. The reviewer measured, on the real component:
 *
 *   {"statuses":["Sign-in could not be completed. Check your connection and try
 *     again."],"details":[{"open":false,"text":"··· Base Disconnect Sign-in
 *     could not be completed…"}],"signInEnabled":true}
 *
 * Its own process, for the same reason as `connected-identity.test.tsx`: the
 * probe replaces the wagmi and auth modules, and bun's module mocks are
 * process-wide.
 */
test("D-R3-m1: a failed sign-in is readable without opening the wallet menu", () => {
	const script = String.raw`
		import { plugin } from "bun";
		const A = "0x00000000000000000000000000000000000000aa";
		plugin({ name: "sign-in-failure-probe", setup(build) {
			build.module("wagmi", () => ({ exports: {
				useConnection: () => ({ address: A, isConnected: true, chainId: 8453 }),
				useConnect: () => ({ connect: () => {}, connectors: [], isPending: false, error: null }),
				useDisconnect: () => ({ disconnect: () => {} }),
				useSignMessage: () => ({ signMessageAsync: async () => "0x" }),
				useSwitchChain: () => ({ switchChain: () => {} }),
			}, loader: "object" }));
			build.module("@/lib/wagmi", () => ({ exports: { config: { chains: [{ id: 8453, name: "Base" }], connectors: [] } }, loader: "object" }));
			build.module("next/navigation", () => ({ exports: { useRouter: () => ({ refresh: () => {} }) }, loader: "object" }));
			build.module("@/lib/auth/actions", () => ({ exports: {
				// No session for this address, so the component renders the
				// "Sign in" + "···" branch the finding is about.
				readSignInSession: async () => null,
				// The failure itself: the challenge request never answers.
				requestSignInChallenge: async () => { throw new Error("offline"); },
				signOut: async () => {},
				verifySignInSignature: async () => ({ ok: false, reason: "signature_invalid" }),
			}, loader: "object" }));
		}});
		const { mount } = await import("./src/test/hook-runner.ts");
		const { WalletBar } = await import("./src/components/auth/wallet-bar.tsx");
		const h = mount(WalletBar, {});
		await h.settle();
		const signIn = h.button(/Sign in/);
		h.click(signIn);
		await h.settle();
		// Every status element, and every status element that a CLOSED <details>
		// hides. The second list is what the finding is about.
		const statuses = h.find(n => n.props.role === "status").map(n => n.text.trim());
		const hidden = h.find(n => n.type === "details").map(n => n.text);
		console.log(JSON.stringify({
			statuses,
			hiddenStatuses: statuses.filter(text => hidden.some(menu => menu.includes(text))),
			signInEnabled: signIn.props.disabled !== true,
		}));
	`;
	const child = Bun.spawnSync([process.execPath, "--preload", "./test/setup.ts", "-e", script], {
		cwd: new URL("../../..", import.meta.url).pathname,
		env: { ...process.env, DATABASE_URL: "", SKIP_ENV_VALIDATION: "1" },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({ code: 0, stderr: "" });
	const measured = JSON.parse(child.stdout.toString());
	expect(measured.statuses).toEqual([
		"Sign-in could not be completed. Check your connection and try again.",
	]);
	// The whole point: no status element is inside the closed disclosure.
	expect(measured.hiddenStatuses).toEqual([]);
	// …and the retry is still offered, exactly as before.
	expect(measured.signInEnabled).toBe(true);
});

/**
 * D-R3-2 (Astra lane D, pass 3): the connect dialog rendered inside the sticky
 * header (`z-index:30`), which trapped its own `z-index:60` inside that stacking
 * context — so the agent launcher and panel (`z-index:38`, document level) sat
 * above the "modal". Measured by the reviewer:
 *   {"modalInsideHeader":true,"launcherOutsideHeader":true,
 *    "headerZ":30,"scrimZ":60,"launcherZ":38}
 *
 * The markup half of the proof: with a document present, the scrim is a child of
 * `#modal-root`, NOT of the element that rendered `ConnectDialog`. The pointer
 * half is the headless-browser shot in the report.
 */
test("D-R3-2: the connect dialog is portalled to the document-level modal layer", () => {
	const script = String.raw`
		// No DOM library in this workspace, so the document is hand-rolled: the
		// portal asks for #modal-root, and React only checks nodeType.
		const modalRoot = { id: "modal-root", nodeType: 1 };
		const body = { id: "body", nodeType: 1 };
		globalThis.document = {
			getElementById: (id) => (id === "modal-root" ? modalRoot : null),
			body,
			activeElement: null,
		};
		const { ConnectDialog } = await import("./src/components/auth/connect-dialog.tsx");
		const { mount } = await import("./src/test/hook-runner.ts");
		const props = { connectors: [], pending: false, error: null, onSelect: () => {}, onClose: () => {} };
		// Called inside a render so the real hook dispatcher is installed; the
		// element it RETURNS is what this probe is about.
		let element = null;
		mount(() => { element = ConnectDialog(props); return null; }, {});
		console.log(JSON.stringify({
			isPortal: element !== null && element.$$typeof === Symbol.for("react.portal"),
			container: element === null ? null : element.containerInfo?.id ?? null,
			// The dialog itself is unchanged: same scrim, same modal role.
			scrimClass: element?.children?.props?.className ?? null,
		}));
	`;
	const child = Bun.spawnSync([process.execPath, "--preload", "./test/setup.ts", "-e", script], {
		cwd: new URL("../../..", import.meta.url).pathname,
		env: { ...process.env, DATABASE_URL: "", SKIP_ENV_VALIDATION: "1" },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({ code: 0, stderr: "" });
	expect(JSON.parse(child.stdout.toString())).toEqual({
		isPortal: true,
		container: "modal-root",
		scrimClass: "scrim",
	});
	// With no document — server rendering — it is returned in place, which is the
	// only correct answer there and is what the four `renderToStaticMarkup` cases
	// above still measure.
	expect(
		renderToStaticMarkup(
			<ConnectDialog connectors={[]} pending={false} error={null} onSelect={() => {}} onClose={() => {}} />,
		),
	).toContain('class="scrim"');
});

/**
 * The other half of D-R3-2: `#modal-root` really is the LAST child of `<body>`
 * in the root layout, so the scrim competes in the root stacking context rather
 * than inside the header's.
 */
test("D-R3-2: the layout renders #modal-root after the launcher", async () => {
	const layout = await Bun.file(new URL("../../app/layout.tsx", import.meta.url).pathname).text();
	expect(layout).toContain('<div id="modal-root" />');
	expect(layout.indexOf("<AgentLauncher />")).toBeLessThan(layout.indexOf('<div id="modal-root" />'));
});
