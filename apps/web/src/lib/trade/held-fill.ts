/**
 * C#2 (lane C confirming pass, finding 2). A fill that the wallet has already
 * broadcast, held until the server writes a durable row for it.
 *
 * Round 2 kept that fill in component state and a ref, which survives a retry
 * inside one mount and nothing else. The reviewer remounted the ticket — a page
 * reload, a back/forward, a hot reload — and measured
 * `MOUNT {"sends":2,"records":3}`: the fresh component knew nothing about the
 * money that had already left the wallet, offered "Trade", and sent a SECOND
 * fill.
 *
 * So the pair the server needs — the transaction hash and the signed ticket the
 * calldata was built from — is written to `sessionStorage` the instant the
 * wallet answers, and read back on mount. `token` is the server-signed ticket
 * itself: `record.ts` decodes it into the ticket hash that fences the pending
 * row (`positions.ticket_hash`), so storing the token stores that identity
 * without the browser ever having to know it.
 *
 * Deliberately NOT `localStorage`: a fill that is still unrecorded a browser
 * session later is a support case, not a button the user should keep pressing.
 * `sessionStorage` also scopes it to the tab, which is where the user is.
 *
 * Every read and write is wrapped: a private window, a browser configured to
 * block site data, and server rendering all make these accessors throw or
 * absent. A storage failure must never take the ticket down — the SERVER fence
 * (`prepareTradeFor`'s unrecorded-fill refusal) is the one that holds when this
 * one is unavailable.
 */

/** The slice of `Storage` this module uses. */
export interface FillStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface HeldFill {
	readonly token: string;
	readonly txHash: string;
}

/**
 * Keyed by chain AND wallet: a fill belongs to one wallet on one chain, and a
 * user who switches accounts must not be shown the other account's fill.
 */
export function heldFillKey(chainId: number, wallet: string): string {
	return `thesis.held-fill.${chainId}.${wallet.toLowerCase()}`;
}

/** `window.sessionStorage`, or null wherever it is absent or refused. */
export function sessionFillStore(): FillStore | null {
	try {
		const store = (globalThis as { sessionStorage?: FillStore }).sessionStorage;
		return store ?? null;
	} catch {
		return null;
	}
}

const HEX_TX = /^0x[0-9a-fA-F]{64}$/;

/**
 * Reads the held fill back. Anything that is not a well-formed pair is treated
 * as absent AND removed: a half-written or hand-edited value must not become an
 * argument to `recordTrade`.
 */
export function readHeldFill(store: FillStore | null, chainId: number, wallet: string | null): HeldFill | null {
	if (store === null || wallet === null) return null;
	const key = heldFillKey(chainId, wallet);
	let raw: string | null;
	try {
		raw = store.getItem(key);
	} catch {
		return null;
	}
	if (raw === null) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
		const { token, txHash } = parsed as { token?: unknown; txHash?: unknown };
		if (typeof token !== "string" || token === "") throw new Error("no token");
		if (typeof txHash !== "string" || !HEX_TX.test(txHash)) throw new Error("no hash");
		return { token, txHash };
	} catch {
		try {
			store.removeItem(key);
		} catch {
			// A store that cannot be cleaned is still a store that returns nothing usable.
		}
		return null;
	}
}

/** Writes the held fill. A storage failure is swallowed: see the module note. */
export function writeHeldFill(store: FillStore | null, chainId: number, wallet: string | null, fill: HeldFill): void {
	if (store === null || wallet === null) return;
	try {
		store.setItem(heldFillKey(chainId, wallet), JSON.stringify({ token: fill.token, txHash: fill.txHash }));
	} catch {
		// See the module note: the server fence is the one that must hold.
	}
}

/** Clears it. Called only on a TERMINAL recording answer — a durable row. */
export function clearHeldFill(store: FillStore | null, chainId: number, wallet: string | null): void {
	if (store === null || wallet === null) return;
	try {
		store.removeItem(heldFillKey(chainId, wallet));
	} catch {
		// Nothing to do; the next read will simply return it again.
	}
}
