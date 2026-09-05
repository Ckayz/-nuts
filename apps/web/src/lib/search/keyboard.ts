export function searchKey(key: string, selected: number, count: number): number | "close" | "open" | null {
	if (key === "Escape") return "close";
	if (!count) return null;
	if (key === "Enter") return "open";
	// TODO-OWNER: arrow navigation wraps; no initial selection until navigation.
	if (key === "ArrowDown") return (selected + 1) % count;
	if (key === "ArrowUp") return selected <= 0 ? count - 1 : selected - 1;
	return null;
}
