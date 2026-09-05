import { expect, test } from "bun:test";
import Image from "@/app/t/[slug]/opengraph-image";
import { thesisDetails as domainDetails } from "@/mock/data";
import { thesisDetails } from "./view-data";
import { shareVerification, thesisShareData } from "./share-data";

test("image handler returns a 1200 by 630 PNG", async () => {
  const fixture = thesisDetails[0]!;
  const response = await Image({ params: Promise.resolve({ slug: fixture.thesis.slug }) });
  expect(response.headers.get("content-type")).toContain("image/png");
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new DataView(bytes.buffer);
  expect(header.getUint32(16)).toBe(1200);
  expect(header.getUint32(20)).toBe(630);
});
test("unconfirmed fixture never earns a verified mark or P&L", () => {
  const fixture = thesisDetails[0]!;
  expect(thesisShareData(fixture.thesis.slug)).toMatchObject({ verified: false, pnl: null });
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
  expect(thesisShareData("missing")).toBeUndefined();
  await expect(Image({ params: Promise.resolve({ slug: "missing" }) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
});
