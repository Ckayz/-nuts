/**
 * The composer form's `useActionState` state.
 *
 * Its own module because `lib/thesis/actions.ts` is a `"use server"` file —
 * every export of one must be an async function — and the client component
 * needs this type. Pure: no imports, nothing server-only, so the client bundle
 * carries nothing from the write path.
 */
export interface PublishFormState {
	/**
	 * One of the machine-readable reasons from `./publish` (`blank_headline`,
	 * `invalid_tag`, `slug_conflict`, `sign_in_required`, `mock_mode`), or null
	 * before the first submit. The composer maps it to copy.
	 */
	error: string | null;
}
