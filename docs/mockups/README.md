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

- **One accent** (`--accent: #6f5cff`). It appears on primary buttons, the active tab
  underline, the selected side, the share-card frame, the "Open" chip and focus rings —
  nowhere else. `--accent-lift` (`#a99bff`) is the same hue, lightened only so accent
  text on a dark tint clears 4.5:1.
- **Colour only on money.** `--gain` / `--loss` are used on numbers. Never on bars,
  backgrounds, labels or names. The percent beside a P&L is neutral text with a coloured
  arrow, so one number carries the colour, not two.
- **Radius varies by role**: frame 24 · card 18 · panel/field 14–16 · row 12 · chip 999.
  Nothing is uniform.
- **Hairlines, not shadows.** The only blurred shadow in the file is the dialog's. The
  other `box-shadow` uses are zero-blur rings: the selected structure row's inset accent
  bar, and the 2px cut-outs behind the three stacked avatars on the "new theses" button.
- **Manrope only**, five weights, `tabular-nums` on every number. No mono font.
- **No charts.** Thetanuts has no price history, so the product never draws one.
- No gradients, no glassmorphism, no ticker tape, no icon rail.

## Content

Everything is example data carried over from the previous mockup so the product content
is unchanged. Values the owner must set are tagged `TODO-OWNER` in place.
