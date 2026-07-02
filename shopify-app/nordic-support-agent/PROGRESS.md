# Progress — Vitrio (multi-tenant SaaS dashboard)

Last updated: 2026-07-02

## Where we are

**Production is live at https://www.vitrio.se** (Vercel project
`nordic-support-agent`, team vitrio-s-projects). The multi-tenant migration is
applied to the production DB, sign-in works, and the platform is ready to
onboard pilot clients.

## Decisions (final)

| Topic | Decision |
|---|---|
| Client model | **Agency / invite-only.** The platform admin provisions client workspaces from `/admin`. No self-signup — `startSignIn` silently no-ops for unknown emails (anti-enumeration). |
| Auth | Extended the existing **magic-link** system. No passwords, no external auth provider. |
| User model | `User` + `WorkspaceMembership` (role `owner`/`member`) + user-based `WorkspaceSession` with `activeWorkspaceId`. One user can belong to several workspaces (switcher UI). |
| Super-admin | `PLATFORM_ADMIN_EMAILS` env var (currently **sim.karlstrom@gmail.com**), deliberately not a DB flag — bootstraps on an empty DB, no in-app escalation path. `/admin` 404s for everyone else. |
| Isolation | Tenant id (`shop` column = workspace UUID) comes **only** from `requireWorkspace(request)` (`app/lib/workspace-auth.ts`), never from query/body. Membership re-verified per request → revocation is immediate. |
| Impersonation | "View as workspace" from `/admin`: stored on the admin's own session row, 2-hour cap, banner on every page, start/stop audit-logged to `AdminAuditLog`. |
| Disable workspace | Suspends member sign-in **and** bumps `tokenEpoch` on the workspace's assistants so outstanding widget tokens die. |
| Brand | Public/product name is **Vitrio** (shells, admin header, sign-in email). Internal package names (`@nordic-support/agent`) unchanged. |
| Deferred (deliberate) | Billing, client-initiated team invites, per-workspace API keys, Redis-backed rate limiting (in-memory bucket resets per serverless instance — do before real traffic). |
| Untouched | Shopify OAuth path (`/app/*`), widget/chat APIs, DSAR, crons — separate trust domains. |

## Shipped

- Multi-tenant auth + admin (`31e85ba`): schema/migration
  `20260611120000_users_and_memberships`, `workspace-auth.ts` rewrite,
  `/admin` + `/workspaces` + `/settings` routes, impersonation, dev-bypass
  security fix. 40/40 tests passing.
- Build runs `prisma migrate deploy` (`2400918`); migrations use
  `directUrl = env("DIRECT_URL")` with a `DATABASE_URL` fallback in the build
  script, because Supabase's transaction pooler (port 6543) hangs prisma
  migrate's advisory locks.
- **Landing page** (`app/routes/_index/route.tsx`): Swedish-language lander
  matching the dashboard design system (warm cream / forest sage / tan,
  Fraunces display serif, JetBrains Mono micro-labels). Hero chat mock,
  3-step "Så funkar det", feature grid, trust strip, demo CTA
  (`mailto:hej@vitrio.se` — set up this mailbox/forwarding!). Verified at
  1440px and 390px.
- Rebrand to Vitrio in onboarding/admin shells, platform-admin header and the
  magic-link email subject.

## Verified end-to-end (local, 2026-07-02)

1. Admin magic-link sign-in → `/admin` ✓
2. Create workspace from `/admin` (posts to `/admin?index`) → owner invite
   link issued ✓
3. Client sign-in → `/onboarding/welcome` → install page renders snippet +
   live widget preview token ✓
4. `/api/widget-public-token?a=<assistantId>` issues a workspace-scoped token;
   `/widget.js` serves ✓
5. `/admin` 404s for non-admin client ✓
6. Impersonation start → banner on `/insights` → stop ✓

Production smoke (2026-07-02): lander live on vitrio.se, `/signin` returns the
generic invite-only response (new tables exist → migration applied).

## Onboarding a pilot client (runbook)

1. Sign in at https://www.vitrio.se/signin as sim.karlstrom@gmail.com.
2. `/admin` → create workspace (name + client email) → client gets a
   magic-link invite automatically.
3. Client (or you, via impersonation) walks onboarding: brand → persona →
   knowledge (upload policies / crawl sitemap) → install.
4. Install page gives the one-liner:
   `<script src="https://www.vitrio.se/widget.js" data-assistant="…" async defer></script>`
5. Follow conversations in `/insights`; disable the workspace from `/admin`
   if a pilot ends.

## Next steps

1. Set up the `hej@vitrio.se` mailbox (or change `CONTACT_EMAIL` in
   `app/routes/_index/route.tsx`).
2. RESEND: production sends magic links via Resend — confirm the from-address
   domain (`RESEND_FROM_ADDRESS`) is verified for vitrio.se so invites don't
   land in spam.
3. Before real traffic: Redis/KV-backed rate limiting (in-memory bucket resets
   per serverless instance).
4. Later: billing, client team invites, per-workspace API keys; drop the
   deprecated `Workspace.ownerEmail` column in a cleanup migration.
