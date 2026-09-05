import "server-only";

/** Request Google Fonts' non-browser CSS and require Satori-supported TTF/WOFF.
 * Cache successful font loads in-process; a failed load remains retryable. */
let pending: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[]> | undefined;
export function ogFonts() {
	pending ??= loadFonts().catch(error => { pending = undefined; throw error; });
	return pending;
}
export async function loadFonts(read: typeof fetch = fetch) {
	const response = await read("https://fonts.googleapis.com/css?family=Manrope:400,700", {
		headers: { "User-Agent": "Thesis-OG" },
	});
	if (!response.ok) throw new Error("Could not load Manrope font stylesheet");
	const css = await response.text();
	return Promise.all(([400, 700] as const).map(async weight => {
		const block = css.split("}").find(part => part.includes(`font-weight: ${weight};`));
		const source = block?.match(/src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\(['"](?:truetype|woff)['"]\)/)?.[1];
		if (!source) throw new Error(`Manrope ${weight} has no Satori-supported font source`);
		const font = await read(source);
		if (!font.ok) throw new Error(`Could not load Manrope ${weight}`);
		return { name: "Manrope", data: await font.arrayBuffer(), weight, style: "normal" as const };
	}));
}
