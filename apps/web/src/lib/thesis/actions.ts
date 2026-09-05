"use server";

/**
 * Composer server actions. Same shape as `lib/social/actions.ts`: check the
 * session first, refuse in mock mode, then hand a real database handle to the
 * write in `./publish`.
 *
 * `redirect` is called OUTSIDE any try/catch — it works by throwing, so a catch
 * around it would swallow the navigation (Next 16 docs,
 * `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`:
 * "redirect throws an error so it should be called outside the try block").
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@nuts/db";
import { getSession } from "../auth/session";
import { usingDatabase } from "../data/source";
import type { PublishFormState } from "./form-state";
import { writePost, type PublishError, type PublishedPost } from "./publish";

/**
 * Publish a text post from the connected wallet's session.
 *
 * Authorisation is re-checked here rather than trusted from the page that
 * rendered the form (Next 16 docs, `01-app/02-guides/forms.md`: "Always verify
 * authentication and authorization inside each Server Action").
 */
export async function publishPost(input: {
	headline: unknown;
	rationale?: unknown;
	taggedAsset?: unknown;
}): Promise<PublishedPost | PublishError | { error: "mock_mode" }> {
	const session = await getSession();
	if (!session) return { error: "sign_in_required" };
	if (!usingDatabase()) return { error: "mock_mode" };

	const result = await writePost(db, {
		userId: session.userId,
		headline: input.headline,
		rationale: input.rationale,
		taggedAsset: input.taggedAsset,
	});
	if ("error" in result) return result;

	// The new post belongs at the top of the feed and on its author's profile.
	revalidatePath("/");
	revalidatePath("/u/[handle]", "page");
	return result;
}

/** `useActionState` shape: the previous state, then the submitted form. */
export async function publishPostFromForm(
	_previous: PublishFormState,
	formData: FormData,
): Promise<PublishFormState> {
	const result = await publishPost({
		headline: formData.get("headline"),
		rationale: formData.get("rationale"),
		taggedAsset: formData.get("taggedAsset"),
	});
	if ("error" in result) return { error: result.error };
	redirect(`/t/${result.slug}`);
}
