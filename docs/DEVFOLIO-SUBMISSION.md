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
| `tracksToApplyTo` | track UUIDs | **BEST PRODUCT BUILT ON THE THETANUTS SDK** `c420ac4b297d45c2a39b988f97eb6e98` (600 / 400 USDC) and **AI × OPTIONS** `76c7ee52e01545c581dff4cd98daa32e` (500 / 300 / 200 USDC — "an AI agent that places a real on-chain options trade … live on Base mainnet": only claim this track if the agent's approval-gated execution is merged and demonstrated) |
| `links` | 0–5, include the public repo | `https://github.com/Ckayz/-nuts` (public once the owner flips it), the live URL after the Vercel deploy |
| `video_url` | optional | a 1–2 minute demo (owner) |
| `cover_img`, `favicon` | optional | the share card image works as a cover |
| `platforms` | 0–5 | Web |

## Screenshots available now (2026-09-05, `.research/thetanuts/ui-fold-shots/` on the orchestrator's machine — copy into `docs/screenshots/` before uploading; the upload goes through Devfolio's signed upload URL tool)
- feed (live markets, posts, share/explain) · market page with the live OptionBook structures and the ticket · position share card with a real derived P&L · thread with a trade card · search dropdown · phone view of the ticket.

## Draft copy for the two required fields (owner edits before publishing)
**The problem it solves.** Options on chain are hard to find and harder to talk about. Thesis.fun makes a trade a post: pick any market Thetanuts has liquidity for on Base, take a side with your own wallet, and the position gets its own page with a live P&L card. Say why in a post; link the trade and it unfurls into a card, X-style. Likes, comments, follows and a leaderboard built only from onchain fills, so a track record cannot be faked and a losing thesis cannot be deleted. An approval-gated AI agent explains any thesis and proposes trades; the wallet signs everything.

**Challenges we ran into.** The SDK's own comment about which side the maker is on was backwards; we decoded production fills from Base bytes and pinned the rule with tests. Maker signatures expire in about a minute, so the ticket approves first, then re-quotes right before the fill. Thetanuts publishes no price history, so we removed the chart rather than fake one. Everything shown is derived from the fill event and the raw order, never from the quote.
