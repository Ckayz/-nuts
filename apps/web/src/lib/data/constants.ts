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
 * TODO-OWNER: activity page size.
 *
 * `listActivity` had no bound at all (lane B, 2026-09-05 21:50), so a profile
 * with a long history read every follow, like, comment, post and fill it had
 * ever produced. There is no pixel to cite for this one: the mockup draws no
 * activity list on any view (grepped — the string "activity" does not appear in
 * docs/mockups/thesis-fun-mockup.html), so this mirrors CREATOR_PAGE_SIZE, the
 * bound on the profile page that reads it. It is a bound, not an approved
 * number, exactly like the four above.
 */
export const ACTIVITY_PAGE_SIZE = 50;

/**
 * Position statuses that represent a real onchain fill. `pending` and `failed`
 * are excluded, matching the `positions_confirmed_fill_event_required` CHECK,
 * which requires a fill event exactly for these four.
 */
export const FILLED_POSITION_STATUSES = ["confirmed", "indexed", "expired", "settled"] as const;

/**
 * Thesis statuses a page may render — the ONE public-status list.
 *
 * B3: there used to be two. This one was `["open", "settled"]` while
 * `lib/social/guards.ts` `SOCIAL_PUBLIC_STATUSES` was
 * `["open", "expired", "settled"]`, so the rankings admitted an `expired` post
 * that `display.thesisWithOrigin` then THREW on — one expired row crashed the
 * whole feed. `expired` is public (the option's expiry has passed, the post is
 * still a post) and now has a presentation, so it is listed here and
 * `SOCIAL_PUBLIC_STATUSES` re-exports this constant rather than restating it.
 *
 * A `draft` or `cancelled` headline must still never leave the database.
 */
export const PUBLIC_THESIS_STATUSES = ["open", "expired", "settled"] as const;

/** TODO-OWNER: six feed posts in docs/mockups/thesis-fun-mockup.html:534–700; no UI slice. */
export const RANKED_THESIS_LIMIT = 6;
/** TODO-OWNER: seven trader rows in docs/mockups/thesis-fun-mockup.html:472–492; no UI slice. */
export const LEADERBOARD_LIMIT = 7;
