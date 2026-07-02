# Security Review — Vitrio (nordic-support-agent)

Date: 2026-07-02. Scope: the multi-tenant SaaS dashboard, magic-link auth,
platform admin/impersonation, and the public widget/chat surface. Method:
five parallel focused reviews (tenant isolation, auth/session, widget
tokens & public endpoints, injection/SSRF/uploads, admin/headers/secrets),
with the critical/high findings verified by hand against the running app.

## Summary

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | **Critical** | Cross-tenant assistant takeover (IDOR) in `/preview/chat` action | ✅ Fixed & verified |
| 2 | **Critical** | Verification-tier bypass — client-supplied "verified" email exfiltrates order PII | ✅ Fixed |
| 3 | **High** | Workspace suspension bypass — disabled client can re-mint widget tokens | ✅ Fixed & verified |
| 4 | **High** | SSRF in the sitemap crawler (cloud metadata / internal network, results read back via bot) | ⏳ Open — recommend next |
| 5 | Medium | Rate limiting bypassable (spoofable `X-Forwarded-For`) + per-instance memory | ⏳ Open |
| 6 | Medium | Missing security headers (HSTS, nosniff, Referrer-Policy, frame policy) | ⏳ Open |
| 7 | Medium | Magic-link codes logged in full when Resend env vars missing | ⏳ Open (mitigated — Resend now configured) |
| 8 | Medium | Origin allowlist is advisory only (header-based, off by default) | ⏳ Open (by-design note) |
| 9 | Medium | Chat body-size cap bypassable by omitting `Content-Length` | ⏳ Open |
| 10 | Medium | Upload/PDF memory-exhaustion (size checked after buffering; no extracted-text cap) | ⏳ Open |
| 11 | Medium (low conf.) | DSAR magic-link uses attacker-controllable Host header | ⏳ Open |
| 12 | Low | Sign-in timing side-channel enables email enumeration | ⏳ Open |
| 13 | Low | Attacker can invalidate a victim's pending magic links (login DoS) | ⏳ Open |
| 14 | Low | `/auth/signout` & `/admin/impersonation/stop` mutate state over GET | ⏳ Open |
| 15 | Low | Admin actions performed while impersonating aren't attributed in the audit log | ⏳ Open |
| 16 | Low | Cron secret compared with `!==` (non-constant-time) | ⏳ Open |

---

## Fixed in this review (deployed)

### 1. CRITICAL — Cross-tenant assistant takeover (IDOR)

`app/routes/preview.chat.tsx` (the action). Assistant ids arrive in the POST
body and are **public** — they ship in every merchant's install snippet
(`<script … data-assistant="ID">`) and are accepted as `?a=ID` by the public
token endpoint. Every id-based mutation (`rename`, `delete`, `set-default`,
`toggle-published`, `revoke-tokens`, `save-settings`) passed that id straight
to helpers in `assistants.ts` that query by `id` alone, with no `shop`
constraint. `requireWorkspace` only proved the caller was a valid member of
*their own* workspace — it never checked the target assistant belonged to it.

Impact: any signed-in tenant could harvest a competitor's assistant id from
that competitor's public website and then rename, **delete**, unpublish (take
their live bot offline), revoke their widget tokens, or **rewrite their entire
config** — including pointing `handoffEmail` at themselves (diverting support
tickets containing customer PII) or injecting agent rules (prompt injection
into the victim's live bot). This directly breaks the platform's core
isolation guarantee.

Fix: an `ownedAssistantId()` guard that loads the assistant and confirms
`assistant.shop === workspace.id` before every mutation. Verified live:
a workspace-A session renaming a workspace-B assistant is now a no-op (target
unchanged), while renaming its own assistant still works.

### 2. CRITICAL — Verification-tier bypass / order-PII exfiltration

`app/routes/api.chat.ts` and `api.chat.stream.ts`. On the first message of a
conversation the public widget could send `context.verifiedCustomerEmail`,
which was written into the conversation as the **verified** identity
(`verifiedEmail`). The order-lookup tool trusts that value: if the queried
email equals `verifiedEmail`, it returns full order PII (name, address, refund
amounts). So an attacker set `verifiedCustomerEmail` to a victim's address and
pulled that victim's orders — completely skipping the magic-link `verify_code`
flow that tier-2 merchants specifically enable to protect PII.

Fix: never trust that field; a new conversation is always born unverified.
Verified identity can now only be established server-side by the `verify_code`
flow (`markConversationVerified`). Language/country hints from the widget are
still honored (not security-sensitive).

### 3. HIGH — Workspace suspension bypass

`app/lib/admin.ts` / `api.widget-public-token.ts` / chat routes. Disabling a
client in `/admin` only bumped `tokenEpoch`, which kills *already-issued*
tokens for a few seconds. It never unpublished the assistant, and nothing on
the public path checked `workspace.disabledAt` — so the widget just re-fetched
a **fresh** token carrying the new epoch and kept running, burning the
(suspended, likely non-paying) client's LLM budget.

Fix: a new `isShopSuspended(shop)` check on the public-token endpoint and both
chat paths. Verified live: token issuance returns 200 → **404 once disabled** →
200 again after re-enable.

---

## Open findings — recommended order

### 4. HIGH — SSRF in the sitemap crawler *(fix next)*

`app/lib/sitemap-crawler.ts` fetches whatever URL a workspace configures, with
no scheme allowlist, no private-IP/link-local block, no redirect control, and
no response-size cap. A tenant can point it (directly or via a `302` from a
public URL, or via `<loc>` entries inside a sitemap) at
`http://169.254.169.254/…` (cloud metadata), `localhost`, or internal
`10./192.168.` hosts. Worse, the fetched body is **ingested into the knowledge
base**, so stolen internal/metadata content becomes readable back through the
chatbot — a clean exfiltration channel for cloud credentials.
Fix: resolve DNS and reject private/loopback/link-local/CGNAT ranges before
connecting, pin the resolved IP, set `redirect: 'manual'` and re-validate each
hop, restrict to http/https, and cap response bytes while streaming.

### 5. Medium — Rate limiting bypassable & non-durable

`app/lib/rate-limit.ts`: `getClientIp` trusts the **leftmost**
`X-Forwarded-For` (client-controlled), so rotating that header gives a fresh
bucket every request; and buckets live in per-instance memory (ineffective on
Vercel). This underlies the sign-in email-bombing, enumeration-at-scale, and
denial-of-wallet abuse. Fix: derive the IP from a trusted proxy position and
move buckets to Vercel KV / Upstash Redis (already flagged as a pre-traffic
item in PROGRESS.md).

### 6. Medium — Missing security headers

Only Shopify's embed headers are set. The standalone dashboard has no HSTS,
`X-Content-Type-Options: nosniff`, `Referrer-Policy`, or explicit frame
policy. Add these globally, scoping any `frame-ancestors`/`X-Frame-Options`
so `/widget*` stays embeddable.

### 7. Medium — Magic-link codes logged when Resend unset

`handoff-sender.ts` falls back to a console sender that logs the full email
body — including the live magic link — whenever `RESEND_API_KEY`/
`RESEND_FROM_ADDRESS` are missing, and `startSignIn` returns success anyway,
so a prod misconfig is silent. Mitigated now that Resend is configured, but
recommend failing closed (refuse to boot / no console fallback) in production.

### 8–11. Medium

- **Origin allowlist** (`origin-allowlist.ts`) is enforced from request
  headers a non-browser client controls, and is empty by default — treat it
  as anti-embedding UX, not a security boundary. The real backstop is the
  per-shop daily spend cap.
- **Chat body cap** (`api.chat*.ts`) reads `Content-Length` from the client;
  omit it and `request.json()` buffers an unbounded body. Enforce a real byte
  limit while reading the stream.
- **Upload/PDF** (`knowledge.ts`): 5 MB cap is checked *after* the whole file
  is buffered, multiple files per request, and extracted text is uncapped
  before chunk-embedding (paid). Enforce a request byte limit and an
  extracted-text length cap.
- **DSAR link** (`api.dsar.start.ts`) builds the emailed magic link from the
  attacker-controllable `X-Forwarded-Host`; a poisoned host could deliver a
  valid DSAR token to an attacker. Build the link from a trusted configured
  base URL. (Lower confidence — Vercel typically overrides the host.)

### 12–16. Low

Sign-in **timing** difference (email send only on the known-email path) allows
enumeration despite the identical response body; an attacker can **invalidate
a victim's pending links** by re-requesting sign-in (login DoS) — both share
the rate-limit root cause. `/auth/signout` and `/admin/impersonation/stop`
mutate state over **GET** (convert to POST). Admin mutations made **while
impersonating** aren't attributed to the admin in `AdminAuditLog` (the start
is logged, not the individual changes). The **cron secret** is compared with
`!==` — use the existing `constantTimeEq`.

---

## Verified secure (no action needed)

- **Magic-link token design**: 192-bit random codes, SHA-256 stored (never
  plaintext), 15-min TTL, single-use (burned on verify), per-code 5-attempt
  cap, constant-time comparison. No cross-user sign-in; email is only ever
  matched against its own code row. No open redirect (`next` is server-decided
  from a fixed set).
- **Session cookie** `nsa_ws_session`: HttpOnly, SameSite=Lax, Secure in prod,
  random UUID id validated against the DB every request. No fixation.
- **Tenant isolation** everywhere except finding #1: tenant id comes only from
  `requireWorkspace`; membership is re-verified per request (instant
  revocation); `disabledAt` → 403; no `preview-shop` dev bypass remains.
  `insights`, `knowledge` delete, DSAR, `api.chat` all re-check `shop`.
- **Platform admin**: every admin loader *and* action re-calls
  `requirePlatformAdmin` (404, not 403); role is never read from a form field;
  all mutations are audit-logged.
- **Impersonation**: admin status + 2h expiry re-checked every request;
  non-admins can't assume it; start/stop logged with the real admin identity.
- **Widget token**: real HMAC-SHA256, constant-time verify, no default/fallback
  secret (throws if `WIDGET_TOKEN_SECRET` is missing/short); epoch re-checked
  every request. Not forgeable.
- **SQL**: all pgvector raw queries use Prisma tagged-template parameters — no
  injection. No `$queryRawUnsafe`/`$executeRawUnsafe` anywhere.
- **XSS**: the widget's hand-rolled markdown renderer escapes all text and
  scheme-checks links; the admin uses react-markdown without `rehype-raw`; the
  only `dangerouslySetInnerHTML` is a static CSS string.
- **CORS**: reflects Origin without `Allow-Credentials` — no credentialed-
  wildcard bug (auth is bearer-token, not cookies).
- No hardcoded secrets; `.env` is gitignored and not committed; errors don't
  leak stack traces to clients.
