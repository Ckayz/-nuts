import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Manrope for the two Open Graph image routes, read from THIS repository.
 *
 * 9(a). This used to request `fonts.googleapis.com` and then `fonts.gstatic.com`
 * on every cold render, so a Google hiccup — or an egress-restricted runtime —
 * made `/t/<slug>/opengraph-image` and `/p/<id>/opengraph-image` throw a 500
 * instead of drawing a share card. The bytes are vendored now
 * (`src/assets/manrope-{400,700}.ttf`, provenance and OFL licence in
 * `src/assets/README.md`), so neither route makes ANY outbound request.
 *
 * The path is `process.cwd()`-relative, which is the pattern Next documents for
 * `ImageResponse` fonts (`node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/01-metadata/opengraph-image.md`). `vercel.json` gives the
 * `web` service `root: apps/web`, and `next start` is run from the same place,
 * so the working directory is the app directory in both. `next.config.ts` also
 * names the files in `outputFileTracingIncludes` so the deployment carries them.
 *
 * Satori reads TrueType and WOFF but not WOFF2, so these are `.ttf`.
 */
export type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };

const FONT_FILES = { 400: "manrope-400.ttf", 700: "manrope-700.ttf" } as const;

/** Cache successful loads in-process; a failed read stays retryable. */
let pending: Promise<OgFont[]> | undefined;
export function ogFonts() {
	pending ??= loadFonts().catch(error => {
		pending = undefined;
		throw error;
	});
	return pending;
}

export function fontPath(weight: 400 | 700, cwd: string = process.cwd()): string {
	return join(cwd, "src", "assets", FONT_FILES[weight]);
}

export async function loadFonts(read: (path: string) => Promise<Buffer> = readFile): Promise<OgFont[]> {
	return Promise.all(([400, 700] as const).map(async weight => {
		const bytes = await read(fontPath(weight));
		if (bytes.byteLength === 0) throw new Error(`Vendored Manrope ${weight} is empty`);
		return {
			name: "Manrope",
			// A Buffer is a view on a pooled ArrayBuffer, so hand Satori this
			// font's own bytes rather than the whole pool.
			data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
			weight,
			style: "normal" as const,
		};
	}));
}
