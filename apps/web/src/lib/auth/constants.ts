/**
 * Sign-in-with-wallet constants. Pure values only, so tests and the client bundle
 * can import this file without pulling in the database or `node:crypto`.
 *
 * Every duration here is a placeholder the owner must replace. They are tagged
 * TODO-OWNER and are deliberately short so a wrong guess expires rather than
 * lingering. PRD 19 forbids inventing product policy; these are engineering
 * defaults for local development, not approved values.
 */

/** Base mainnet. PRD 18 and the `auth_challenges_base_chain` CHECK both pin 8453. */
export const AUTH_CHAIN_ID = 8453;

/** TODO-OWNER: nonce time-to-live. Placeholder only. */
export const CHALLENGE_TTL_SECONDS = 300;

/** TODO-OWNER: session length. Placeholder only. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24;

/** TODO-OWNER: cookie name is not a product decision, but is pinned here once. */
export const SESSION_COOKIE_NAME = "thesis_session";

/** Statement of the message the user signs. TODO-OWNER: user-facing wording. */
export const SIGN_IN_STATEMENT =
	"Sign in to Thesis.fun. This request does not move funds and costs no gas.";
