"use client";
import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProfile } from "@/lib/profile/actions";
import type { ProfileFields } from "@/lib/profile/validation";

export function ProfileEditor({ profile, walletAddress }: { profile: ProfileFields; walletAddress: string }) {
	const router = useRouter();
	const [saved, setSaved] = useState(profile);
	const [optimistic, setOptimistic] = useOptimistic(saved);
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	// TODO-OWNER: profile editor labels, Save/error copy and content limits await owner approval; no mockup screen exists.
	return <section className="panel">
		<form onSubmit={(event) => {
			event.preventDefault();
			const form = new FormData(event.currentTarget);
			const input = { handle: String(form.get("handle") ?? ""), displayName: String(form.get("displayName") ?? ""), bio: String(form.get("bio") ?? "") };
			setError(null);
			startTransition(async () => {
				setOptimistic({ handle: input.handle.toLowerCase() || null, displayName: input.displayName || null, bio: input.bio || null });
				try {
					const result = await updateProfile(input);
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
				{field === "bio" ? <textarea className="inp" name={field} defaultValue={profile[field] ?? ""} disabled={pending} /> : <input className="inp" name={field} defaultValue={profile[field] ?? ""} disabled={pending} maxLength={field === "handle" ? 32 : undefined} />}
			</label>)}
			{pending ? <p className="dim" aria-live="polite">{optimistic.displayName ?? optimistic.handle ?? walletAddress}{optimistic.bio ? ` · ${optimistic.bio}` : ""}</p> : null}
			{error ? <p role="alert">{error}</p> : null}
			<button className="btn primary" type="submit" disabled={pending}>Save</button>
		</form>
	</section>;
}
