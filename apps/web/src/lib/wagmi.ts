import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";

/**
 * Base mainnet only (PRD 18). There is no testnet path: Thetanuts' live OptionBook
 * liquidity is on chain 8453, and the Safe Allowance Module is not deployed on Base
 * Sepolia, so a testnet build would not exercise the real flow.
 */
export const config = createConfig({
	chains: [base],
	connectors: [
		injected(),
		coinbaseWallet({ appName: "Thesis.fun", preference: "all" }),
	],
	// Cookie storage keeps the connection readable during SSR so the first paint
	// does not flash a disconnected state.
	ssr: true,
	storage: createStorage({ storage: cookieStorage }),
	transports: {
		[base.id]: http(),
	},
});

declare module "wagmi" {
	interface Register {
		config: typeof config;
	}
}
