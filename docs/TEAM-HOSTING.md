# Hosting on Vercel — for the team (owner 2026-09-05: "The vercel project will be hosted by my team")

Everything below is read from the repo's own config (`vercel.json`, `apps/web/.env.example`, `packages/env/src/server.ts`, `docs/DEPLOY.md`) and from measurements made on 2026-09-05. Nothing here is a guess. Do the steps in this order; the gate in step 0 is the owner's rule.

## 0. Gate — do not deploy before this
The one-shot review must be **GREEN** (`CLAUDE.md` § Current state says where it stands; `docs/OPEN-WORK.md` lists what is still open). Deploying earlier ships known money-path defects.

## 1. What the repo already tells Vercel
- `vercel.json` (repo root) declares one service `web` with `root: apps/web`, framework Next.js, and `installCommand: cd ../.. && bun install` (the workspace installs from the repo root; bun only). Every path rewrites to that service. So: **import the repo as ONE Vercel project, leave the Root Directory at the repository root** (the file picks `apps/web` itself), framework preset Next.js, build command default (`next build`).
- The build is a **database build**: `next build` runs with `NODE_ENV=production`, and the app refuses to prerender from fixtures in production (`apps/web/src/lib/data/source.ts`, measured 2026-09-05). If `DATA_SOURCE=db` is not set at BUILD time the build fails with "Production requires DATA_SOURCE=db". Set every variable in step 2 for **Production and Preview** before the first build.

## 2. Environment variables (Vercel → Project → Settings → Environment Variables)
From `apps/web/.env.example` and `packages/env/src/server.ts`:

| Variable | Value | Notes |
|---|---|---|
| `DATA_SOURCE` | `db` | Required at build and runtime. |
| `DATABASE_URL` | the Supabase **transaction pooler** URL, port **6543** (`postgresql://postgres.<ref>:<password>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`) | The app uses this. Vercel functions open many short connections; the pooler is what survives that. |
| `DIRECT_DATABASE_URL` | leave EMPTY on Vercel | Only drizzle-kit uses it, and migrations are run from a laptop (step 3), never from Vercel. |
| `SESSION_SECRET` | 32+ random characters, e.g. `openssl rand -hex 32` | Required in production; the build fails without it. Never reuse a value from anywhere else. |
| `OPENROUTER_API_KEY` | the team's OpenRouter key | Optional in the env schema, but ONE of this and `AI_GATEWAY_API_KEY` must be set or `/agent` fails at import: measured 2026-09-06 with both cleared, `apps/web/src/lib/agent/model.ts` throws `No model credential. Set AI_GATEWAY_API_KEY (preferred) or OPENROUTER_API_KEY.` Everything except the agent still runs. |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key, or leave unset | Optional. When set it REPLACES OpenRouter for both agent models. Do NOT set it while `AGENT_MODEL` is a `:free` OpenRouter id — those ids are OpenRouter's and the gateway does not serve them. |
| `NEYNAR_API_KEY` | Neynar key, or leave unset | Optional. Without it the "From Farcaster" rail renders an honest "not configured" line and makes no request. It must ALSO be listed in `turbo.json`'s `tasks.build.env`, like every other variable (see §4b). |
| `AGENT_MODEL`, `AGENT_GATE_MODEL`, `BASE_RPC_URL`, `THETANUTS_ORDERS_URL`, `THESIS_REFERRER` | as in `apps/web/.env.example` | Optional with defaults. `AGENT_MODEL` defaults to `anthropic/claude-haiku-4.5` (corrected 2026-09-06: the previous `:free` OpenRouter default is not served by Vercel AI Gateway and failed every turn when the gateway key was set); `AGENT_GATE_MODEL` stays on the paid `anthropic/claude-haiku-4.5`. Free tiers are rate-limited and return 429 or 502 under load: measured 2026-09-06 on the owner's key, FIFTY free model requests per day shared across every `:free` id (`X-RateLimit-Limit: 50`, reset 00:00 UTC), which is a tighter ceiling than the app's own daily limits (PRD 10.2) and so is what a demo hits first. `THESIS_REFERRER` defaults to the owner's referrer wallet — keep it, that is the revenue address. |

The owner's laptop can push its gitignored `apps/web/.env` to Vercel with `bun run env:production -- --yes` (`scripts/sync-vercel-env.ts`), but the dashboard is the simpler path for the team. That script is fail-closed: it pushes only keys in the validated env schemas (so the owner's `PROD_*`/`SUPABASE_*` keys are skipped by name), refuses the whole run when a value it would push is local (any loopback host — `localhost`, the whole `127.0.0.0/8` block, `::1`, `0.0.0.0` — or `file:`) or empty in `production`, and refuses to overwrite without `--yes` (`-- --dry-run` prints the plan instead). Never commit any of these values.

## 3. Production database — migrate BEFORE the first deploy
The app needs tables `users`, `theses`, `positions`, … Production held `0000`–`0008` — 9 rows in `drizzle.__drizzle_migrations`, 14 tables — measured 2026-09-06 01:31 through the session pooler, read-only. (It held only `0000_agent_tables` on 2026-09-05 18:0x; that line is superseded.) The command below is therefore expected to be a no-op; run it anyway and read what it prints. From a laptop with the repo:
```
# session pooler (port 5432 on the pooler host — the only IPv4 route; the direct host is IPv6-only)
cd packages/db
DIRECT_DATABASE_URL='postgresql://postgres.<ref>:<url-encoded password>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres' DRIZZLE_ALLOW_REMOTE=1 bunx drizzle-kit migrate
```
Never `drizzle-kit push` against the shared project (it can DROP the other developer's tables — `CLAUDE.md` § Commands). Details and recovery: `docs/DEPLOY.md`.

## 4. Deploy and verify
1. Trigger the production deploy (push to `main`, or "Redeploy" in the dashboard). Watch the build log for the `DATA_SOURCE` error above — it means step 2 was missed.
2. Open `/`, `/m/btc`, `/new`, `/portfolio`, sign in with a wallet on Base, post, like. Every route should answer 200; the Markets panel must show the live book (6–8 assets), not "unavailable".
3. **Custom domain**: assign it in Vercel → Domains. A pasted `https://<domain>/p/<id>` link unfurls into a trade card as soon as the page is served on that domain: `lib/site-origin.ts` accepts BOTH the deployment URL (`VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL`) and the origin the request actually arrived on, so a branch alias and a custom domain both work without waiting for either to become the production domain. (Measured 2026-09-05 on a db-mode production build: with the deployment URL set to one name, a link written on a second name unfurled when the page was served on that second name.) A link written on a THIRD origin the deployment never answers on stays plain text, which is the intended fence.
4. Then the owner's tiny real fill (`packages/thetanuts/scripts/README.md`) is the final proof of the money path.

## 4b. If the build fails with "Invalid environment variables"

Setting a variable in the Vercel dashboard is not enough. **Turborepo filters the environment
strictly**: a variable set on the project but not listed in `turbo.json`'s `tasks.build.env` is
withheld from the task, and the app sees it as `undefined`. The build then dies at env
validation naming the variable, while the real cause is printed far below as a *warning*:

```
WARNING - the following environment variables are set on your Vercel project, but missing
from "turbo.json". These variables WILL NOT be available to your application
  - OPENROUTER_API_KEY  - DATA_SOURCE  - SESSION_SECRET  - DATABASE_URL
```

Fixed on 2026-09-05 by declaring every server variable in `turbo.json`. **Adding a variable to
`packages/env/src/server.ts` means adding it to `turbo.json` too**, or the next deploy fails the
same way. Note `turbo.json` rejects `"//"` comment keys, so this note lives here instead.

Reproduce locally with `bun run build` (through turbo), not `bunx next build` — the direct call
bypasses the filter and passes even when Vercel would fail.

## 5. Things that will bite
- Preview deployments get their own database URL only if you set one; do not point previews at production data.
- The agent needs ONE model credential at runtime — `AI_GATEWAY_API_KEY` (what this deployment uses, owner decision 2026-09-06 03:4x) or `OPENROUTER_API_KEY`. Without either, `/agent` fails at import.
- **The model id and the provider must agree.** A gateway id never carries `:free`; an OpenRouter `:free` id needs NO gateway key. Both at once is what took the agent down on 2026-09-06 (`da09e81`): the gateway serves no `:free` id, every turn died with `GatewayModelNotFoundError`, and the route still answered HTTP 200. `apps/web/src/lib/agent/model.ts` now refuses that pairing at startup instead.
- **When the agent misbehaves, open `GET /api/agent/health`.** It calls no model and costs nothing (safe to poll): 200 when the configuration is consistent, 503 with the exact problem when it is not. `?probe=1` additionally makes one two-token call per model and returns an `errorClass` per model — `ok`, `model_not_found`, `no_credit`, `rate_limited`, `provider_down`, `unknown` — but it SPENDS MODEL CREDIT, so an uptime monitor must not use it; the answer is cached for 60 s. Since C-P2-2 that probe is OPERATOR-ONLY and off by default: it needs `AGENT_HEALTH_PROBE_TOKEN` set on the deployment (16+ characters) and presented in the `x-agent-probe-token` header, and answers 403 without it while calling no model. The plain GET is unchanged and stays public. The class table and the fix per class are in `docs/DEPLOY.md`, "If the agent fails".
- A free-tier `AGENT_MODEL` is the other consistent setup (no gateway key). Measured 2026-09-06 on the owner's key: 50 free model requests PER DAY shared across every `:free` id (reset 00:00 UTC), then every call 429s. That provider ceiling binds before the app's own daily limits (PRD 10.2). Adding 10 credits to the OpenRouter account raises it to 1000/day; a paid id removes it. Decide before a live demo.
- Vercel's build must run `bun install` from the repo root (the `installCommand` does that); a project imported with Root Directory = `apps/web` and the default install command breaks the workspace links.
