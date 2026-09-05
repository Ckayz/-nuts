# Devfolio submission — MUBA Blockchain Hackathon (`muba-hackathon`) — checklist, NOT submitted (owner 2026-09-05: "Dun submit first tho")

Read live from Devfolio's own submission guide on 2026-09-05 19:5x via the Devfolio MCP (owner authenticated). A draft project already exists: **"Thesis.fun"**, slug `thesisfun-68be`, team **爱nuts** (2 members), status `draft`, created 2026-09-05 10:22 UTC — tagline, pictures, fields, links, hashtags and tracks are all EMPTY.

## Required to publish (per Devfolio's guide)
| Field | Rule | Proposed value (owner edits) |
|---|---|---|
| `name` | 2–50 chars | Thesis.fun (already set) |
| `tagline` | 2–50 chars | e.g. "Post a thesis. Back it with a real option." (`TODO-OWNER`) |
| `hashtags` (technologies) | 1–10 | Thetanuts, Base, Next.js, wagmi, viem, Drizzle, Supabase, Bun, AI SDK |
| `pictures` | 1–6 **real screenshots of the running project** (no generated stand-ins) | see the list below |
| `projectFieldAnswers` | both organizer fields required, markdown supported | **"The problem it solves"** (UUID `16658fe42db84f88b27ece038012a991`) and **"Challenges we ran into"** (UUID `7d4ae8a15ce0498bbd3ab528f84ff513`) — draft texts below |
| `tracksToApplyTo` | track UUIDs | **BEST PRODUCT BUILT ON THE THETANUTS SDK** `c420ac4b297d45c2a39b988f97eb6e98` (600 / 400 USDC) and **AI × OPTIONS** `76c7ee52e01545c581dff4cd98daa32e` (500 / 300 / 200 USDC — "an AI agent that places a real on-chain options trade … live on Base mainnet": only claim this track if the agent's approval-gated execution is merged and demonstrated). **OWNER DECISION 2026-09-05 20:0x: apply to BOTH Thetanuts tracks** ("Tracks we can choose both of the thetanuts ones"). |
| `links` | 0–5, include the public repo | `https://github.com/Ckayz/-nuts` (public once the owner flips it), the live URL after the Vercel deploy |
| `video_url` | optional | a 1–2 minute demo (owner) |
| `cover_img`, `favicon` | optional | the share card image works as a cover |
| `platforms` | 0–5 | Web |

## Screenshots available now (2026-09-05, `.research/thetanuts/ui-fold-shots/` on the orchestrator's machine — copy into `docs/screenshots/` before uploading; the upload goes through Devfolio's signed upload URL tool)
- feed (live markets, posts, share/explain) · market page with the live OptionBook structures and the ticket · position share card with a real derived P&L · thread with a trade card · search dropdown · phone view of the ticket.

## Draft copy for the two required fields (owner edits before publishing)
**The problem it solves.** Options on chain are hard to find and harder to talk about. Thesis.fun makes a trade a post: pick any market Thetanuts has liquidity for on Base, take a side with your own wallet, and the position gets its own page with a live P&L card. Say why in a post; link the trade and it unfurls into a card, X-style. Likes, comments, follows and a leaderboard built only from onchain fills, so a track record cannot be faked and a losing thesis cannot be deleted. An approval-gated AI agent explains any thesis and proposes trades; the wallet signs everything.

**Challenges we ran into.** The SDK's own comment about which side the maker is on was backwards; we decoded production fills from Base bytes and pinned the rule with tests. Maker signatures expire in about a minute, so the ticket approves first, then re-quotes right before the fill. Thetanuts publishes no price history, so we removed the chart rather than fake one. Everything shown is derived from the fill event and the raw order, never from the quote.

## Ready to file (2026-09-05 21:2x) — waits for the owner's "submit"
- Pictures: `docs/screenshots/01-feed-1440.png`, `02-market-btc-1440.png`, `03-thread-1440.png`, `04-position-1440.png`, `05-search-1440.png`, `06-market-390.png` (six; `07-new-1440.png` is the spare). Shot from main `86a00a0` on a clean seeded database; one real Base position.
- Tracks: both Thetanuts tracks (owner 20:0x).
- Tagline (≤50 chars, OWNER picks one or writes their own): "Post a thesis. Back it with a real option." (42) · "Say it, then trade it, onchain on Base." (39) · "Options trading you can talk about." (35).
- Hashtags: Thetanuts, Base, Next.js, wagmi, viem, Drizzle, Supabase, Bun, AI SDK.
- The two required fields: the draft copy above (owner edits).
- Repo: `https://github.com/Ckayz/-nuts` (public at submission time — confirm).
- Filing path: `mcp__devfolio__getSignedUploadUrl` per image → upload → `mcp__devfolio__updateHackathonProject` with name, tagline, hashtags, pictures, the two fields, `tracksToApplyTo`, repo link → the owner presses submit in Devfolio (or asks Claude to). Nothing is uploaded or written to the draft until the owner says so.


## SUBMITTED 2026-09-05 22:50 +0800 (published_at 14:50:20Z, commit "Submit Thesis.fun: copy, six screenshots, tracks")
Verified by `getMyHackathonProject`: status `publish`, team status `submit`; tagline "Say it. Trade it. Real onchain options on Base." (owner's words, 47 chars); six pictures (`docs/screenshots/01…06`); both organizer fields answered in Markdown; hashtags Thetanuts, Base, Next.js, wagmi, viem, Drizzle, Supabase, Bun, AI SDK; link `https://github.com/Ckayz/-nuts`; platform Web; tracks BEST PRODUCT BUILT ON THE THETANUTS SDK + AI × OPTIONS with applications. Not set: video, cover image, favicon (optional). Edits after submission go through `updateHackathonProject` with a new commit message.

- **23:28 +0800:** live site link added to the submission (`https://nuts-web-kappa.vercel.app/`, the team's Vercel deploy; answered 200 with the app). Commit "Add live site link (Vercel)". NOTE (corrected 2026-09-06 01:3x): the production database was found fully migrated (0000–0008, 14 tables) at 01:31; the earlier "only 0000" note was stale.
