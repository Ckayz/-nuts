# fomo — measured design digest

Written 2026-09-06 from live measurement, for the UI/UX pass. Every number below is
either read out of `getComputedStyle` on fomo's own page or sampled pixel-by-pixel
from their own product screenshots. Nothing here is remembered or estimated; where a
thing could not be measured it says so.

## Provenance, and its one important limit

`https://fomo.family/tokens/robinhood/0x39dbed…4571` **cannot be read from outside a
logged-in session.** The server returns 200 with the marketing shell (8,747 bytes, the
landing page's `<title>`), and the client router then redirects to `/`. A console error
from their own bundle — `TypeError: Failed to fetch` at `index-C4V-Gi_H-v2…js:107` — fires
just before the redirect, so the token route appears to bounce when its data call fails
unauthenticated. Their CSP also blocks WalletConnect and analytics for an unauthenticated
visitor.

So the digest is measured from two sources, and their reliability differs:

1. **The landing page itself**, live — fonts, type scale, radii, background colours.
2. **Their own full-resolution product screenshots**, served from `fomo.family/images/landing/`:
   `fomo-desktop.webp` (2889×2783, the token page), `social-static.webp` (1380×1050, the
   feed), `leaderboard.webp` (1478×912). These are marketing assets, so they show the
   product as fomo chose to present it. Layout and colour read cleanly off them; exact
   spacing in CSS pixels does not, because the shot is scaled and perspective-free but not
   1:1 with any viewport.

**Not measured, and only a logged-in session will give it:** hover and focus states,
transitions, the real grid widths in px, empty states, error states, mobile web layout.

## Palette, sampled from `fomo-desktop.webp`

| Role | fomo | ours (`apps/web/src/index.css`) | gap |
|---|---|---|---|
| page background | `#070511` (their `<meta name=theme-color>` says `#060510`) | `--bg #0b0b10` | theirs is darker and **violet-tinted**; ours is neutral |
| panel / row | `#181623` | `--surface #14141b` | same, theirs carries the violet tint |
| tile / field | `#15141b`, inputs `#13111b` | `--surface2 #1b1b24` | ours lighter than theirs |
| chip | `#24232a` | — | no direct equivalent |
| accent | `#596ce9`, badge fill `#394dbd` | `--accent #6f5cff` | theirs is **bluer**; ours more purple |
| gain | `#1cce59` | `--gain #22c55e` | effectively the same |
| loss | `#fd6536` | `--loss #f4634f` | effectively the same — note both are **orange-leaning**, not pure red |
| body text | `#f7f7f7` | `--text #f2f2f5` | same |

The takeaway: our money colours are already right. The two real differences are the
**violet tint in the dark neutrals** and an accent that sits a step bluer than ours.

## Type

`font-family: Aeonik` throughout, one family, plus `ui-monospace` for a single eyebrow
label. **Aeonik is a commercial licence we do not hold**, so it is not an option; the
free faces closest in skeleton are Satoshi or General Sans (Fontshare). Manrope, which we
ship, is rounder and more humanist than Aeonik but is a defensible stand-in.

Measured scale on the landing page, by frequency: `14px/500` dominant, then `16px/500`,
`16px/700`, `18px/700`, `22px/500`, `28px`, `36px/500`, `40px`, `60px/500`.

**Weight 500 is the body weight, not 400.** That single fact accounts for a lot of the
"classy" impression — the whole interface sits one notch heavier than a default.

## Radii

Measured on the landing page: `6, 8, 12, 16, 25px`. Their Privy modal ships its own scale
(`6/8/12/16/24/9999`). Ours is `12 row / 14–16 panel / 18 card / 24 frame / 999 chip` —
already the same idea, one step larger at the card level.

## Token page layout (`fomo-desktop.webp`)

Three columns, fixed–flex–fixed.

- **Top bar**: wordmark left; a genuinely centred search (`Search for tokens or usernames…`)
  with a `⌘+K` badge inside the field at its right; on the right two stacked-label balance
  chips (`$100 / Cash balance`, `$100 / +1.32 24h`) and the avatar.
- **Left column** (~23% of width): tabs `Tokens · Feed · Leaderboard` with collapse
  controls; filter chips `Verified · Trending · Most held · Gainers` plus a filter icon;
  then rows of coin avatar, ticker over market cap, price over signed percent with a ▲/▼.
- **Centre**: an instrument header — avatar, name, verified tick and social icons, the
  truncated contract address with a copy button, a star; then a row of **stat tiles**
  (`Price · Market cap · 24H change · Vol. · Liquidity · Holders`), muted label above,
  value below, hairline border, no fill.
- Chart is TradingView, timeframes `1D 5D 1M 3M 6M YTD 1Y 5Y All` bottom-left, `% log auto`
  bottom-right.
- **`Chart overlays`: `Friends` · `Top Traders` · `Your trades`** — checkboxes that plot
  other traders' entries as avatars **on the candles**. This is the signature idea of the
  whole product: the social layer is drawn onto the price, not parked beside it.
- Below the chart, two panels side by side: `Holders (45.34K)` with `Thesis only` /
  `Friends only` checkboxes and columns Trader / Avg. entry / Position / PnL; and
  `Trades | Thesis` tabs with Trader / Action / Amount / Market Cap / Time.
- **Right column** (~23%): `Buy | Sell` segmented control (Buy fills green `#0a2c1f` ground,
  green label; Sell stays neutral); a large amount field reading `$0` with `Enter amount`
  right-aligned inside it; preset chips `$25 $50 $100 $250` and a gear; one line of
  `$4.32K available` / `$2.32 fee`; then the primary `Buy HOUSTON` button. Under it: your
  position card, then **an inline thesis composer**, then `About HOUSTON`, then
  `Your positions` with an `Open / Closed` toggle.

### They call it a thesis

`Trades | Thesis` is a tab on the token page; `Write a thesis on HOUSTON…` is the composer
placeholder; `Thesis only` filters the holder table; and a `Thesis` badge marks the post
type in the feed. Our product name and our core noun are the same word they use. Worth
knowing before the demo — it is convergent, not derivative, but a judge who uses fomo will
notice.

### About-panel pattern worth stealing

`About HOUSTON` renders `5M · 1H · 6H · 24H` tiles, then paired bars: `234 buys / 23 sells`,
`$989.K vol / $394.K vol`, `3.23K buyers / 850 sellers` — each a single split bar, green
left, red right, width proportional. Dense, instantly readable, no chart. It is the best
idea on the page for us, because it needs no price history — which is exactly the
constraint that removed our charts.

## Feed (`social-static.webp`)

Posts are **rows separated by hairlines, not cards**. Each: avatar (circle), handle in
white semibold, a **type badge**, then relative time in muted.

Badges are tinted-ground pills: `Thesis` violet on `#394dbd`-family ground, `Buy` green,
`Sell` orange-red — the same three colours as the money vocabulary.

A thesis post shows its text at ~17px, then an **embedded position card** on a lighter
ground: coin avatar, the label `Position` with a small dot, ticker with verified tick, and
right-aligned the value in white over the P&L in green. Then a muted action row —
♥ 293 · 👁 8492 · ⤷ 3 older.

A trade post has **no prose at all**: coin avatar, ticker, `$34.3K at $642.3M MC`, with the
amount and the cap in white and the words `at` and `MC` in muted. Money in white, grammar
in grey.

## Leaderboard (`leaderboard.webp`)

🥇🥈🥉 for the top three then a plain `4.`; avatar; display name in white over `@handle`
in muted; P&L right-aligned, green, large, tabular.

## What this means for our redesign

Close already: money colours, the dark ground, hairlines over shadows, one accent, colour
reserved for money.

Worth changing:
1. **Tint the neutrals violet.** `#070511` / `#181623` rather than `#0b0b10` / `#14141b`.
2. **Body weight 500**, not 400.
3. **Type badges on posts** (`Thesis` / `Bull` / `Bear`) as tinted pills — we have the
   vocabulary, not the treatment.
4. **Posts as hairline-separated rows**, not bordered cards.
5. **The paired split-bar stat block** from `About`, which needs no price history.
6. **Stat tiles across the market header** — we have the values, not the layout.

Deliberately not copied: TradingView with avatars on candles (we have no price history —
CLAUDE.md records the owner's ruling), and Aeonik (licence).

Per the repo's own rule, design changes go through `docs/mockups/thesis-fun-mockup.html`
first, then code. This digest is the input to that mockup revision, not a licence to edit
components directly.
