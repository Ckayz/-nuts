import "server-only";

/**
 * HANDOVER (trade round, 2026-09-05): the composer left this round's scope.
 * Publishing a text post, with the session supplied by the caller so a test can
 * drive the write without a request context. Nothing imports this today.
 */
import { db as defaultDb } from "@nuts/db";
import { createOrFetchUser, type Database } from "@/lib/auth/store";
import { normalizeAsset, normalizeHeadline, publishTextPost } from "./store";

export interface PublishPostInput {
	readonly headline: string;
	readonly rationale?: string | null;
	readonly taggedAsset?: string | null;
}

export interface PublishPostFailure {
	readonly ok: false;
	readonly code: string;
	readonly reason: string;
	readonly needsSignIn?: boolean;
}

export interface PublishPostSuccess {
	readonly ok: true;
	readonly thesisId: string;
	readonly slug: string;
}

export async function publishPostFor(
	session: { userId: string; walletAddress: string } | null,
	input: PublishPostInput,
	database: Database = defaultDb,
): Promise<PublishPostSuccess | PublishPostFailure> {
	if (session === null) {
		return { ok: false, code: "NO_SESSION", reason: "Sign in with your wallet to post.", needsSignIn: true };
	}
	let headline: string;
	let taggedAsset: string | null;
	try {
		headline = normalizeHeadline(input.headline);
		taggedAsset = normalizeAsset(input.taggedAsset);
	} catch (error) {
		return { ok: false, code: "INVALID_POST", reason: error instanceof Error ? error.message : "Invalid post." };
	}
	const user = await createOrFetchUser(database, session.walletAddress);
	const thesis = await publishTextPost(database, {
		creatorUserId: user.id,
		headline,
		rationale: input.rationale ?? null,
		taggedAsset,
	});
	return { ok: true, thesisId: thesis.id, slug: thesis.slug };
}
