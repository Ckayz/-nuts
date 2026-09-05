import { expect, test } from "bun:test";
import Image from "@/app/t/[slug]/opengraph-image";
import { thesisDetails as domainDetails } from "@/mock/data";
import { thesisDetails } from "./view-data";
import { shareVerification, thesisShareData } from "./share-data";

test("both image handlers return 1200 by 630 PNGs (offline font substitute)", () => {
  // Isolated renderer probe: exercises PNG/layout with bundled font bytes.
  // Actual Manrope fetching is checked separately; this does not claim font fidelity.
  const child = Bun.spawnSync([process.execPath, "--preload", "./test/setup.ts", "-e", `
    import { plugin } from "bun";
    import { readFile } from "node:fs/promises";
    import { dirname, join } from "node:path";
    const bytes = await readFile(join(dirname(import.meta.resolve("next/package.json").replace("file://", "")), "dist/compiled/@vercel/og/Geist-Regular.ttf"));
    plugin({ name: "offline-og-font", setup(build) {
      build.module("@/lib/og-fonts", () => ({ loader: "object", exports: { ogFonts: async () => [{ name: "Manrope", data: bytes, weight: 400, style: "normal" }] } }));
    }});
    const { default: Image } = await import("./src/app/t/[slug]/opengraph-image.tsx");
    const { thesisDetails } = await import("./src/lib/view-data.ts");
    const { default: PositionImage } = await import("./src/app/p/[id]/opengraph-image.tsx");
    const { yourPositions } = await import("./src/lib/view-data.ts");
    const responses = [
      await Image({ params: Promise.resolve({ slug: thesisDetails[0].thesis.slug }) }),
      await PositionImage({ params: Promise.resolve({ id: yourPositions[0].id }) }),
    ];
    const results = [];
    for (const response of responses) {
      const png = new Uint8Array(await response.arrayBuffer());
      const header = new DataView(png.buffer);
      results.push({ type: response.headers.get("content-type"), magic: [...png.slice(0, 8)], width: header.getUint32(16), height: header.getUint32(20) });
    }
    console.log(JSON.stringify(results));
  `], { cwd: new URL("../..", import.meta.url).pathname, env: { ...process.env, DATABASE_URL: "", SKIP_ENV_VALIDATION: "1" }, stdout: "pipe", stderr: "pipe" });
  expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  const results = JSON.parse(child.stdout.toString());
  expect(results).toHaveLength(2);
  for (const result of results) expect(result).toEqual({ type: "image/png", magic: [137, 80, 78, 71, 13, 10, 26, 10], width: 1200, height: 630 });
});

test("unconfirmed fixture never earns a verified mark or P&L", async () => {
  const fixture = thesisDetails[0]!;
  expect(await thesisShareData(fixture.thesis.slug)).toMatchObject({ verified: false, pnl: null });
});
test("confirmation and a backing are both necessary", () => {
  const domain = domainDetails.find(d => d.thesis.backing !== null)!.thesis;
  const thesis = thesisDetails.find(d => d.thesis.slug === domain.slug)!.thesis;
  const backing = domain.backing!;
  const confirmed = { ...backing, verification: { ...backing.verification, confirmedOnchain: true } };
  expect(shareVerification(thesis, confirmed)).toEqual({ verified: true, pnl: thesis.backing!.creatorLivePnlUsd });
  expect(shareVerification({ ...thesis, backing: null }, confirmed)).toEqual({ verified: false, pnl: null });
  expect(shareVerification(thesis, null)).toEqual({ verified: false, pnl: null });
});
test("unknown image does not borrow another thesis", async () => {
  expect(await thesisShareData("missing")).toBeUndefined();
  await expect(Image({ params: Promise.resolve({ slug: "missing" }) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
});
