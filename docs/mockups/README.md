# Mockups

`thesis-fun-mockup.html` is the visual spec for the Thesis.fun UI. Open it directly, or
serve the folder and use the hash routes:

```bash
cd docs/mockups && python3 -m http.server 3120
# then: http://127.0.0.1:3120/thesis-fun-mockup.html#feed
```

One self-contained file: inline CSS and JS, no dependencies, no build step. The only
network request is the Manrope stylesheet from Google Fonts.

## Views

| Route in the app | Hash | What it shows |
|---|---|---|
| `/` | `#feed` | Top-traders rail · post feed (three post states) · your positions + markets |
| `/m/[asset]` | `#market` | Asset header · live structures from the book · posts about the asset · the trade ticket |
| `/p/[id]` | `#position` | The share card as hero · copy link / write a post · position details |
| — | `?dialog=1` | The post-trade dialog (also reachable from "Preview: after fill" on the market view) |
| `/t/[slug]` | `#thread` | The post at full size · comment box · comments |
| `/u/[handle]` | `#profile` | Profile header · P&L tiles · positions and posts |
| `/new` | `#new` | Composer: text, a linked position previewing as a trade card, market tags |

The top-right wallet chip toggles between the connected and signed-out states when clicked.

## Design rules the code follows

- **One accent** (`--accent: #3f6fe0`). It appears on primary buttons, the active tab
  underline, the selected side, the share-card frame, the "Open" chip and focus rings —
  nowhere else. `--accent-lift` (`#7598e9`) is the same hue, lightened only so accent
  text on a dark tint clears 4.5:1.
- **Colour only on money.** `--gain` / `--loss` are used on numbers. Never on bars,
  backgrounds, labels or names. The percent beside a P&L is neutral text with a coloured
  arrow, so one number carries the colour, not two.
  - **EXCEPTION, 2026-09-06** (owner: "go with defaults for the 9 decisions"): a post's
    DIRECTION DOT may carry `--gain` / `--loss`. The pill around it — `.ptype`, a label —
    stays neutral, so the colour sits on a 6px dot and nowhere else. This is the same
    compromise the rule already makes for the percent beside a P&L.
- **Radius varies by role**: frame 24 · card 18 · panel/field 14–16 · row 12 · chip 999.
  Nothing is uniform.
- **Hairlines, not shadows.** The only blurred shadow in the file is the dialog's. The
  other `box-shadow` uses are zero-blur rings: the selected structure row's inset accent
  bar, and the 2px cut-outs behind the three stacked avatars on the "new theses" button.
- **Manrope only**, five weights, `tabular-nums` on every number. No mono font.
- **No charts.** Thetanuts has no price history, so the product never draws one.
  - **AMENDED 2026-09-06** (owner: the chart stays only if its price line comes from a
    real, named source). The market page carries ONE chart. Its series is Binance spot
    klines read through the app's own `/api/klines/[asset]` proxy, and the page prints
    where they came from under it: "Binance spot, hourly. Thetanuts settles on a
    Chainlink TWAP, which can differ." Nothing else in the product draws a chart, and
    no series is ever synthesised.
- No gradients, no glassmorphism, no ticker tape, no icon rail.

## Shape decided 2026-09-06 (owner defaults 3, 5, 6, 7)

The teammate's shipped feed design is the spec, and this file was updated to match it:

- **The feed's posts are hairline-separated ROWS**, not six cards: `.post-rows > .post`
  drops the border, the radius and the fill, and one `border-top` sits between siblings.
  A thread's hero post is still a card — it IS that page's object.
- **Every feed post carries a type badge** (`.ptype`): `Thesis` for a pure text opinion,
  `Bull` / `Bear` for the direction it names. See the colour exception above.
- **The market header's stat tiles are bordered and unfilled**, each drawing its own
  hairline, so the strip has no divider line of its own. Which tiles exist is decided by
  what the OptionBook actually publishes: 24h change, market cap, volume, liquidity and
  holders are absent because there is no price history and no supply — the same fact that
  removed the chart. Implied vol takes the slot fomo gives 24h volume.
- **"Create" lives in the TOP BAR**, beside the wallet chip, at every width (`.top-create`).
  It used to sit at the end of the nav, which scrolls horizontally, and it was clipped
  below ~500px — and it is the only route to the composer.
- **The profile bio** renders under the name and handle, in the same muted `.meta` text
  the address line uses (`.prof .bio`).
- **On phones (≤900px) the FEED's left column stays in the flow** and `order` puts the Top
  traders card in the single stacked column directly under the posts: the nav's
  "Leaderboard" is an in-page anchor to it, and the blanket `.col-left{display:none}` had
  been scrolling to something hidden. Every other page's left rail is still hidden.

## Amended 2026-09-06 (owner default 1: Bull/Bear name the ASSET's direction)

- **The market ticket's two buttons are relabelled per instrument.** The `#market`
  view has a PUT SPREAD selected, and buying a put is a bear position, so its ticket
  now reads `Bull · sell` / `Bear · buy` and its explanatory line reads "Bear buys the
  spread and pays premium. Bull sells it and posts collateral." — the same two words
  the running app printed on a selected BTC put spread that day, in the app's order.
  A call or call spread keeps `Bull · buy` / `Bear · sell`.
- **KNOWN DRIFT, not yet amended** (needs the owner's word, it is copy): six other
  places in `thesis-fun-mockup.html` still call a bought PUT or put spread "Bull" —
  the position rows at lines 785, 791, 1009 and 1297, the position page's `Side` value
  at line 1038, and its "Trade the same structure" line at 1068. Under this same
  default each of those reads Bear. (Line 1301 is a bought CALL spread and stays Bull.)
  MEASURED 2026-09-06 against the running app for a real bought ETH put: the profile
  and portfolio ROWS print "Bear · $1 risked · …" and the position page's `<title>` is
  "Bear · ETH put", so the app already disagrees with lines 785/791/1009/1297. Line
  1038 has no counterpart at all — the app's position details list a `Direction` row
  reading "Long the structure (bought)", never a `Side · Bull`.

## Content

Everything is example data carried over from the previous mockup so the product content
is unchanged. Values the owner must set are tagged `TODO-OWNER` in place.
