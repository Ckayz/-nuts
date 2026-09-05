# Vendored Manrope (Open Graph images only)

`manrope-400.ttf` and `manrope-700.ttf` are read from disk by `src/lib/og-fonts.ts`
when `/t/<slug>/opengraph-image` and `/p/<id>/opengraph-image` render. They exist so
those two routes make **no outbound request** — the previous version fetched Google
Fonts at request time, so a Google hiccup 500'd both share images (fold item 9(a)).

The browser does NOT use these files: the app loads Manrope through `next/font/google`
in `src/app/layout.tsx`.

## Where the bytes came from

No `@fontsource`-style Manrope package is installed in this workspace (checked
`node_modules`), so the bytes were downloaded once, on 2026-09-05, from the exact
URLs the old runtime code resolved through
`https://fonts.googleapis.com/css?family=Manrope:400,700` sent with
`User-Agent: Thesis-OG` (the legacy CSS API returns TrueType for a non-browser UA):

| File | Source URL | SHA-256 | Bytes | `usWeightClass` |
|---|---|---|---|---|
| `manrope-400.ttf` | `https://fonts.gstatic.com/s/manrope/v20/xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk79FN_C-bw.ttf` | `b5dcb06da262aad2c9d0be97eee78ca777047b0a494491ef2f61bc9ffa594871` | 35728 | 400 |
| `manrope-700.ttf` | `https://fonts.gstatic.com/s/manrope/v20/xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk4aE9_C-bw.ttf` | `14f5689338fc5e3f58a96d5def6e8cfb2a4c8f334f949ac5e5609b89e7ae6e8c` | 35636 | 700 |

Both are TrueType (Satori cannot read woff2). Manrope version 4.504.

## Licence

`OFL.txt` is the SIL Open Font License 1.1 that ships with Manrope, copied from
`https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt` on the same
day (the upstream `sharanda/manrope` repo returns 404 for both `LICENSE` and `OFL.txt`).
