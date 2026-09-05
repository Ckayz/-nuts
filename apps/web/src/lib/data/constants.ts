/**
 * Read-layer placeholders. Every value here is the owner's to set (PRD 19);
 * these are development defaults so a query has a bound, not approved numbers.
 */

/** TODO-OWNER: feed page size. */
export const FEED_PAGE_SIZE = 50;

/** TODO-OWNER: thread comment page size. */
export const THREAD_COMMENT_PAGE_SIZE = 100;

/** TODO-OWNER: portfolio page size. */
export const PORTFOLIO_PAGE_SIZE = 100;

/** TODO-OWNER: creator profile page size. */
export const CREATOR_PAGE_SIZE = 50;

/**
 * Position statuses that represent a real onchain fill. `pending` and `failed`
 * are excluded, matching the `positions_confirmed_fill_event_required` CHECK,
 * which requires a fill event exactly for these four.
 */
export const FILLED_POSITION_STATUSES = ["confirmed", "indexed", "expired", "settled"] as const;
