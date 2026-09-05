export interface ProfileInput { handle?: string; displayName?: string; bio?: string }
export interface ProfileFields { handle: string | null; displayName: string | null; bio: string | null }
export function validateProfile(input: unknown): { fields: Partial<ProfileFields> } | { error: "invalid_profile" | "invalid_handle" } {
	if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "invalid_profile" };
	const fields: Partial<ProfileFields> = {};
	for (const key of ["handle", "displayName", "bio"] as const) {
		if (!(key in input)) continue;
		const value = (input as Record<string, unknown>)[key];
		if (value === undefined) continue;
		if (typeof value !== "string" || value.includes("\0")) return { error: "invalid_profile" };
		const normalized = key === "handle" ? value.toLowerCase() : value;
		// TODO-OWNER: handle bounds mirror users_handle_length (1–32); display name/bio limits remain unset in the schema.
		if (key === "handle" && normalized !== "" && (!/^[a-z0-9_]+$/.test(normalized) || normalized.length > 32)) return { error: "invalid_handle" };
		fields[key] = normalized === "" ? null : normalized;
	}
	return { fields };
}
export function isUniqueViolation(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	if ("code" in error && error.code === "23505") return true;
	return "cause" in error && error.cause !== error && isUniqueViolation(error.cause);
}
