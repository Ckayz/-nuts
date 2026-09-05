// TODO-OWNER: placeholder headline prefix limit = 6 words / 64 ASCII characters;
// the owner sets these bounds. Keep migration 0005's prefix expression in sync.
export const SLUG_MAX_WORDS = 6;
export const SLUG_MAX_CHARS = 64;

/** ASCII-only, locale-independent kebab prefix. No Unicode transliteration. */
export function slugPrefix(headline: string): string {
  return headline.replace(/[A-Z]/g, c => c.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .split("-").slice(0, SLUG_MAX_WORDS).join("-")
    .slice(0, SLUG_MAX_CHARS).replace(/-$/, "");
}

/**
 * Allocate in ascending UUID order for backfill parity. Extend the four-hex
 * suffix one character at a time against occupied slugs. A writer must still
 * handle a unique-index conflict and retry against the refreshed occupied set.
 * Empty prefixes use the full UUID hex, a namespace with no hyphens.
 */
export function deriveSlug(headline: string, id: string, occupied: ReadonlySet<string> = new Set()): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Slug derivation requires a UUID");
  }
  const hex = id.replaceAll("-", "").toLowerCase();
  const prefix = slugPrefix(headline);
  if (!prefix) {
    if (occupied.has(hex)) throw new Error("UUID slug already occupied");
    return hex;
  }
  for (let length = 4; length <= hex.length; length++) {
    const slug = `${prefix}-${hex.slice(0, length)}`;
    if (!occupied.has(slug)) return slug;
  }
  throw new Error("UUID slug already occupied");
}
