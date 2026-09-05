import "server-only";
import { headers } from "next/headers";
import { vercelOrigin } from "@nuts/env/server";

/** Deployment origin first, otherwise the request authority, as in auth/requestDomain. */
export async function siteOrigin(): Promise<string> {
	if (vercelOrigin !== undefined) {
		try { return new URL(vercelOrigin).origin; } catch { /* fall through */ }
	}
	const request = await headers();
	const host = request.get("host");
	if (!host) throw new Error("Request has no Host header");
	const protocol = request.get("x-forwarded-proto") === "https" ? "https" : "http";
	return new URL(`${protocol}://${host}`).origin;
}
