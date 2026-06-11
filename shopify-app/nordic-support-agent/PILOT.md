# Client pilot runbook — script-tag widget

How to put a (non-Shopify) client live with the embeddable widget, and what
to check before handing them the snippet.

## 1. Server prerequisites (one-time, per deployment)

Required env:

| Var | Why |
| --- | --- |
| `WIDGET_TOKEN_SECRET` (32+ chars) | Signs widget tokens. Every widget request fails without it. |
| `DATABASE_URL` | Postgres with pgvector (knowledge chunks). |
| `AI_PROVIDER=gateway` + `AI_GATEWAY_API_KEY` | Agent LLM **and** embeddings — KB ingestion only works through the gateway. |
| `CRON_SECRET` | Auth for the nightly conversation purge (GDPR retention). |

Strongly recommended before a real client pilot:

| Var | Why | Without it |
| --- | --- | --- |
| `RESEND_API_KEY` + `RESEND_FROM_ADDRESS` | Handoff tickets + customer email verification + merchant magic-link sign-in | Emails print to server console only — escalation silently goes nowhere a client can see. |
| `TURNSTILE_SECRET_KEY` + `TURNSTILE_SITE_KEY` | Bot check on the public token endpoint | Falls open (no bot check). Acceptable for a short pilot, not for long-term. |
| `SHOP_DAILY_TOKEN_CAP` | Per-tenant daily LLM spend backstop | Default cap applies (see `lib/spend-cap.ts`). |

If Turnstile is enabled, smoke-test the widget once on a real page — the
invisible challenge renders inside a hidden container and should pass
silently; if it doesn't, the widget surfaces a turnstile error in console.

## 2. Create the client's assistant

1. Client (or you, on their behalf) signs in at `/signin` with their email —
   magic link creates the workspace. **Without Resend configured the link is
   only printed to the server console.**
2. Run the onboarding flow: business profile, persona, knowledge.
3. Knowledge: point the crawler at their sitemap (`/onboarding/knowledge` or
   `/app/knowledge`) and/or upload PDFs/markdown. Crawl is synchronous and
   capped — check documents show `indexed` afterwards.
4. In assistant settings, set `allowedOrigins` to the client's domain(s),
   e.g. `clientsite.se` and `*.clientsite.se`. An empty list means *any*
   site may embed the assistant — fine for a quick demo, wrong for a pilot.
5. Confirm the assistant is `published`.

## 3. Install snippet

One-liner (preferred — tokens auto-mint and auto-renew):

```html
<script src="https://<app-host>/widget.js" data-assistant="<ASSISTANT_ID>" async defer></script>
```

The widget mints a 24h public token from `/api/widget-public-token`,
re-mints automatically if it expires mid-session, and fetches brand/design
config live — so design tweaks in the admin reach the client's site without
touching the snippet.

## 4. What the agent can/can't do for a script-tag client

- **Active:** knowledge-base answers, email handoff/escalation, customer
  email verification, sv/no/da/fi/en UI.
- **Not active:** commerce tools (orders, refunds, shipping). Shopify
  adapters need a Shopify install; Klarna/PostNord live clients are not
  implemented yet (`INTEGRATION_MODE=mock` is dev-only — never live data).

## 5. Known pilot limitations

- Rate limiting is in-memory and per-IP across all tenants: a single
  serverless instance, and many visitors behind one corporate NAT share a
  20 msg/min bucket. Fine for a pilot; move to Redis/KV for production.
- Conversations are capped at 10 customer messages, then the customer is
  asked to start a new chat.
- One widget per page; the script guards against double-loading.
- `widget.js` is served with `Cache-Control: max-age=300` (see
  `vercel.json`) — deployed widget fixes reach clients within ~5 minutes.

## 6. Pre-handoff test checklist

- [ ] Snippet on a test page on the client's actual domain (origin check!)
- [ ] First message → streamed, KB-grounded answer in the right language
- [ ] Follow-up message → context retained (same conversation)
- [ ] Ask something off-KB → honest "don't know" + handoff offer
- [ ] Escalate → handoff email actually arrives at the client's inbox
- [ ] Mobile viewport → fullscreen panel works
- [ ] Privacy footer link opens `/privacy?a=<id>` in the client's language
