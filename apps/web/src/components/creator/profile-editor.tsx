"use client";
import { useId, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConnectedIdentity } from "@/components/auth/connected-identity";
import { updateProfile } from "@/lib/profile/actions";
import type { ProfileFields } from "@/lib/profile/validation";
import { readableError } from "@/lib/messages";

/**
 * B-P3-2 (lane B pass 3, MAJOR). Editing a profile is a write attributed to the
 * session, and it was the one write left outside the mismatch protection the
 * social controls gained in G-4.
 *
 * The window: the connected wallet is B, the cookie session is still A because
 * the mismatch sign-out failed or has not landed (`use-session-mismatch.ts`),
 * and until it resolves this form saved a display name, a handle and a bio onto
 * account A. The reviewer's measurement on the unfixed component:
 *
 *   SAVE           [{"disabled":false,"text":"Save"}]
 *   PROFILE_WRITES [{"handle":"alice","displayName":"Changed while B","bio":""}]
 *   ACTION         {"profile":{"displayName":"Changed while B",…}}
 *   ACTOR          [{"id":"c0000000-…-000000000001","input":{…}}]
 *
 * Two halves, the same two the Like, Follow and comment controls have:
 *   - here, the form is the signed-out form while the identities disagree —
 *     same disabled state, same sentence, nothing new written;
 *   - in `lib/profile/actions.ts`, the connected wallet travels with the call
 *     and `walletGuard` REFUSES a claim that is not the session's wallet. The
 *     cookie stays the identity; the claim can only ever refuse.
 *
 * Said plainly, as the social actions say it: a caller that omits the field gets
 * the old behaviour. The server cannot learn which wallet a browser holds, so
 * this stops MIS-ATTRIBUTION for an honest browser and is not a defence against
 * a hostile one.
 */
export function ProfileEditor({ profile, walletAddress }: { profile: ProfileFields; walletAddress: string }) {
	const router = useRouter();
	const hintId = useId();
	const [saved, setSaved] = useState(profile);
	const [optimistic, setOptimistic] = useOptimistic(saved);
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const identity = useConnectedIdentity();
	const mismatched = identity.mismatched;
	// TODO-OWNER: profile editor labels, Save/error copy and content limits await owner approval; no mockup screen exists.
	return <details className="card pad profile-editor"><summary>Edit profile</summary>
		<form onSubmit={(event) => {
			event.preventDefault();
			// B-P3-2. Belt to the disabled Save's braces: a form can also be
			// submitted with Enter from a field.
			if (mismatched || pending) return;
			const form = new FormData(event.currentTarget);
			const input = { handle: String(form.get("handle") ?? ""), displayName: String(form.get("displayName") ?? ""), bio: String(form.get("bio") ?? "") };
			setError(null);
			startTransition(async () => {
				setOptimistic({ handle: input.handle.toLowerCase() || null, displayName: input.displayName || null, bio: input.bio || null });
				try {
					// B-P3-2. The wallet this browser is holding travels with the call,
					// so the server refuses a write whose two identities disagree.
					const result = await updateProfile(input, identity.address ?? undefined);
					if ("error" in result) { setError(result.error ?? "save_failed"); return; }
					setSaved(result.profile);
					window.dispatchEvent(new Event("profile-updated"));
					router.replace(`/u/${result.profile.handle ?? walletAddress}`);
					router.refresh();
				} catch { setError("save_failed"); }
			});
		}}>
			{(["handle", "displayName", "bio"] as const).map((field) => <label className="field" key={field}>
				<span>{field === "displayName" ? "Display name" : field === "handle" ? "Handle" : "Bio"}</span>
				{field === "bio" ? <textarea className="inp" name={field} defaultValue={profile[field] ?? ""} disabled={pending || mismatched} /> : <input className="inp" name={field} defaultValue={profile[field] ?? ""} disabled={pending || mismatched} maxLength={field === "handle" ? 32 : undefined} />}
			</label>)}
			{pending ? <p className="mut" aria-live="polite">{optimistic.displayName ?? optimistic.handle ?? walletAddress}{optimistic.bio ? ` · ${optimistic.bio}` : ""}</p> : null}
			{error ? <p role="alert">{readableError(error)}</p> : null}
			{/* B-P3-2: the SAME sentence the Like, Follow and comment controls use. */}
			{mismatched ? <p id={hintId} className="mut">Sign in using the wallet control</p> : null}
			<button className="btn acc" type="submit" disabled={pending || mismatched}
				aria-describedby={mismatched ? hintId : undefined}
				title={mismatched ? "Sign in using the wallet control" : undefined}>Save</button>
		</form>
	</details>;
}
