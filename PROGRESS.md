# Progress — script-tag widget pilot readiness

_Last updated: 2026-06-12_

Goal: get the embeddable JS widget (`public/widget.js`, the non-Shopify
install path) finished, deployed, and ready for client pilots in Sweden.

## Status: live in production ✅

| Piece | State |
| --- | --- |
| Production app | https://nordic-support-agent.vercel.app — Vercel team `vitrio-s-projects`, functions pinned to **arn1 (Stockholm)** |
| Database | Supabase `supabase-stockholm` (**eu-north-1**), pgvector, all migrations applied |
| Repo | `github.com/simonkpro/nordic-support-agent` (moved from `bakr-bit`) |
| Email | Resend wired (`Nordic Support <support@vitrio.se>`) — **pending DNS verification of vitrio.se** |
| Demo tenant | HOPE assistant, published: `d6a9f107-16c5-4ec2-9653-7cda249e616a` |

Working demo snippet (paste on any page):

```html
<script src="https://nordic-support-agent.vercel.app/widget.js"
        data-assistant="d6a9f107-16c5-4ec2-9653-7cda249e616a" async defer></script>
```

Verified end-to-end in production: public token mint → widget config via
Authorization header → streamed, KB-grounded Swedish answer → multi-turn
session resumption → clean 401/404 behavior for bad tokens / unknown ids.

## Widget hardening (commit `052a497`)

Fixes from a pre-pilot audit of `widget.js` + its API routes:

- **SSE error events**: the AI SDK emits `{type:'error'}` then ends the
  stream "successfully"; the widget previously showed a forever-spinner.
  Now surfaces an error modal, and drops the optimistic user bubble when
  no reply text arrived.
- **Token auto-renewal**: one-liner installs (`data-assistant`) re-mint
  the 24h public token on 401 and replay the message once — a tab left
  open overnight heals itself. Explicit-token installs still fail loudly.
- **Header auth**: widget-config token moved from `?token=` query string
  (leaks into access logs / CDN cache keys) to the `Authorization`
  header; the route accepts both for back-compat and handles preflight.
- **Caching**: `widget.js` served with `max-age=300, stale-while-revalidate`
  so deployed fixes reach client sites within ~5 minutes.
- A11y: `aria-live="polite"` on the message list.
- Tests: `tests/widget.test.ts` boots the real widget.js in happy-dom and
  covers streaming, error events, re-mint, and session resumption. The
  app workspace's dormant test files are wired into `npm test` (58 tests
  across both workspaces).

## Hosting setup

- Vercel account `simkarlstrom-5453` (sim.karlstrom@gmail.com), project
  `nordic-support-agent`, root directory `shopify-app/nordic-support-agent`,
  framework `react-router` (`@vercel/react-router` preset), `regions: ["arn1"]`.
- Deploys via CLI: `npx vercel deploy --prod` from repo root. No
  GitHub↔Vercel connection yet (optional, needs dashboard OAuth).
- Build runs `prisma generate && prisma migrate deploy && react-router build`;
  migrations use the session-mode connection via `DIRECT_URL` (pgbouncer
  hangs `prisma migrate` advisory locks on the pooled URL).
- Env (production): AI gateway keys/models, `INTEGRATION_MODE=live`,
  fresh `WIDGET_TOKEN_SECRET`/`CRON_SECRET`, `DATABASE_URL` (pooled) +
  `DIRECT_URL` (direct), Resend key + from-address,
  `PLATFORM_ADMIN_EMAILS=sim.karlstrom@gmail.com`, Shopify vars
  (required at boot even for widget-only use — `shopify.server.ts`
  initializes on cold start for every route).
- Daily conversation-purge cron registered (`vercel.json`, 03:00 UTC).
- GDPR posture: compute + data in Sweden, DSAR routes + retention purge
  in app; LLM inference via AI Gateway leaves the EU (disclosed in
  privacy page) — Bedrock/Vertex EU is the escape hatch if a client
  demands it.

## In flight / parallel work

- Platform-admin layer (commit `31e85ba` + uncommitted schema work):
  users/memberships, invite-only access, impersonation, audit log.
- `vitrio.se` DNS records pending → blocks Resend sends (handoff +
  magic-link sign-in emails) until verified.

## Open items

1. **Resend DNS** — verify `vitrio.se` in Resend; sends start working
   automatically, no redeploy needed.
2. **Custom domain** — optionally put the app on `app.vitrio.se`
   (CNAME + `vercel domains add`), then update `SHOPIFY_APP_URL` and the
   PILOT.md snippet so clients see the Vitrio brand.
3. **Confirm `PLATFORM_ADMIN_EMAILS`** — currently sim.karlstrom@gmail.com.
4. **Rotate the Resend API key** (it passed through a chat transcript).
5. **Turnstile keys** — bot check currently falls open; fine for pilot,
   set before leaving it running long-term.
6. **Before scaling past a few clients**: move rate limiting + spend-cap
   counters from in-memory to Redis/Upstash (per-instance today), and
   queue the synchronous sitemap crawl.

## Client onboarding

See `shopify-app/nordic-support-agent/PILOT.md` for the per-client
runbook (workspace creation, knowledge ingestion, `allowedOrigins`,
install snippet, pre-handoff test checklist).
