import { expect, test, describe } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Connector } from "wagmi";

import { ConnectDialog, walletChoices } from "./connect-dialog";
import { isWalletRejection, networkLabel } from "./wallet-bar";

/** Enough of a Connector to exercise the picker. */
function connector(id: string, name: string, icon?: string): Connector {
	return { uid: `uid-${id}-${name}`, id, name, icon, type: "injected" } as unknown as Connector;
}

describe("walletChoices", () => {
	test("drops the generic 'Injected' row when a real wallet announced itself", () => {
		// wagmi's injected() with no target reports its name as the literal string
		// "Injected", and EIP-6963 discovery is on by default — so MetaMask arrives
		// twice, once anonymously and once by name.
		const choices = walletChoices([
			connector("injected", "Injected"),
			connector("coinbaseWallet", "Coinbase Wallet"),
			connector("io.metamask", "MetaMask"),
		]);
		expect(choices.map((c) => c.name)).toEqual(["Coinbase Wallet", "MetaMask"]);
	});

	test("keeps the generic row when nothing else was discovered", () => {
		// A browser wallet that does not announce itself must stay reachable.
		const choices = walletChoices([connector("injected", "Injected")]);
		expect(choices.map((c) => c.name)).toEqual(["Injected"]);
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
